// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.6.11;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/proxy/Initializable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./Forwarder.sol";
import "./SecurityModule.sol";
import "./BaseModule.sol";
import "./IWallet.sol";

/**
 *
 * Wallet
 * ============
 *
 * Basic multi-signer wallet designed for use in a co-signing environment where 2 signatures are required to move funds.
 * Typically used in a 2-of-3 signing configuration. Uses ecrecover to allow for 2 signatures in a single transaction.
 *
 * The first signature is created on the operation hash (see Data Formats) and passed to sendMultiSig/sendMultiSigToken
 * The signer is determined by verifyMultiSig().
 *
 * The second signature is created by the submitter of the transaction and determined by msg.signer.
 *
 * Data Formats
 * ============
 *
 * The signature is created with ethereumjs-util.ecsign(operationHash).
 * Like the eth_sign RPC call, it packs the values as a 65-byte array of [r, s, v].
 * Unlike eth_sign, the message is not prefixed.
 *
 * The operationHash the result of keccak256(prefix, toAddress, value, data, expireTime).
 * For ether transactions, `prefix` is "ETHER".
 * For token transaction, `prefix` is "ERC20" and `data` is the tokenContractAddress.
 *
 *
 */
contract Wallet is IWallet, Ownable, Initializable {
    // Events
    event Deposited(address from, uint value, bytes data);
    event SafeModeActivated(address msgSender);
    event Transacted(
        address msgSender, // Address of the sender of the message initiating the transaction
        address otherSigner, // Address of the signer (second signature) used to initiate the transaction
        bytes32 operation, // Operation hash (see Data Formats)
        address toAddress, // The address the transaction was sent to
        uint value, // Amount of Wei sent to the address
        bytes data // Data sent when invoking the transaction
    );
    event MultiSigReturns(bytes data);
    event AuthorisedModule(address indexed module, bool value);
    event Received(uint indexed value, address indexed sender, bytes data);

    // Public fields
    address[] public signers; // The addresses that can co-sign transactions on the wallet
    uint public override modules;
    bool public safeMode = false; // When active, wallet may only send to signer addresses

    function getSigners() external override view returns (address[] memory) {
        return signers;
    }

    // Internal fields
    uint constant SEQUENCE_ID_WINDOW_SIZE = 10;
    uint[10] recentSequenceIds_;
    address private deployer;

     // The authorised modules
    mapping (address => bool) public override authorised;


     /**
     * @notice Throws if the sender is not an authorised module.
     */
    modifier moduleOnly {
        require(authorised[msg.sender], "sender not authorized");
        _;
    }

    constructor() public {
        deployer = msg.sender;
    }

    /**
     * Set up a simple multi-sig wallet by specifying the signers allowed to be used on this wallet.
     * 2 signers will be required to send a transaction from this wallet.
     * Note: The sender is NOT automatically added to the list of signers.
     * Signers CANNOT be changed once they are set
     *
     * @param allowedSigners An array of signers on the wallet
     */
    function initialize(address[] memory allowedSigners, address[] calldata _modules) public initializer {
        require(allowedSigners.length == 3, "Invalid signers");
        require(signers.length == 0 && modules == 0, "Wallet already initialised");
        require(_modules.length > 0, "Empty modules");
        modules = _modules.length;
        signers = allowedSigners;
        for (uint256 i = 0; i < _modules.length; i++) {
            require(authorised[_modules[i]] == false, "Module is already added");
            authorised[_modules[i]] = true;
            IModule(_modules[i]).init(address(this));
            emit AuthorisedModule(_modules[i], true);
        }
        if (address(this).balance > 0) {
            emit Received(address(this).balance, address(0), "");
        }
    }

    /**
     */
    function authoriseModule(address _module, bool _value) external override moduleOnly {
        if (authorised[_module] != _value) {
            emit AuthorisedModule(_module, _value);
            if (_value == true) {
                modules += 1;
                authorised[_module] = true;
                //IModule(_module).init(address(this));
            } else {
                modules -= 1;
                require(modules > 0, "BW: cannot remove last module");
                delete authorised[_module];
            }
        }
    }

    /**
    * Determine if an address is a signer on this wallet
    * @param signer address to check
    * returns boolean indicating whether address is signer or not
     */
    function isSigner(address signer) public view override returns (bool) {
        // Iterate through all signers on the wallet and
        for (uint i = 0; i < signers.length; i++) {
            if (signers[i] == signer) {
                return true;
            }
        }
        return false;
    }

    modifier onlySigner() {
        require(isSigner(msg.sender), "Invalid Signer");
        _;
    }

    function replaceSigner(address _oldSigner, address _newSigner) external override moduleOnly {
        require(isSigner(_oldSigner), "Invalid index");
        require(!isSigner(_newSigner), "Invalid index");
        for (uint i=0; i<signers.length; i++)
            if (signers[i] == _oldSigner) {
                signers[i] = _newSigner;
                break;
            }
        //TODO emit event
    }

    /**
    * Gets called when a transaction is received without calling a method
    */
    fallback() external payable {
        if (msg.value > 0) {
            // Fire deposited event if we are receiving funds
            emit Deposited(msg.sender, msg.value, msg.data);
        }
    }

    /**
     * Create a new contract (and also address) that forwards funds to this contract
     * returns address of newly created forwarder address
     */
    function createForwarder() public override returns (address) {
        return address(new Forwarder());
    }

    /**
     * Execute a multi-signature transaction from this wallet using 2 signers: one from msg.sender and the other from ecrecover.
     * Sequence IDs are numbers starting from 1. They are used to prevent replay attacks and may not be repeated.
     *
     * @param toAddress the destination address to send an outgoing transaction
     * @param value the amount in Wei to be sent
     * @param data the data to send to the toAddress when invoking the transaction
     * @param expireTime the number of seconds since 1970 for which this transaction is valid
     * @param sequenceId the unique sequence id obtainable from getNextSequenceId
     * @param signature see Data Formats
     */
    function sendMultiSig(
        address toAddress,
        uint value,
        bytes memory data,
        uint expireTime,
        uint sequenceId,
        bytes memory signature
    ) public override onlySigner {
        // Verify the other signer
        bytes32 operationHash = keccak256(abi.encodePacked("ETHER", toAddress, value, data, expireTime, sequenceId));
        bytes memory prefix = "\x19Ethereum Signed Message:\n32";
        bytes32 prefixedHash = keccak256(abi.encodePacked(prefix, operationHash));
        address otherSigner = verifyMultiSig(toAddress, prefixedHash, signature, expireTime, sequenceId);
        // Success, send the transaction
        require(address(this).balance >= value, "Balance not sufficient");
        (bool success, bytes memory returnData) = toAddress.call{value:value}(data);
        require(success, "Transfer failed");
        emit Transacted(msg.sender, otherSigner, operationHash, toAddress, value, data);
        emit MultiSigReturns(returnData);
    }

    /**
    * Do common multisig verification for both eth sends and erc20token transfers
    *
    * @param toAddress the destination address to send an outgoing transaction
    * @param operationHash see Data Formats
    * @param signature see Data Formats
    * @param expireTime the number of seconds since 1970 for which this transaction is valid
    * @param sequenceId the unique sequence id obtainable from getNextSequenceId
    * returns address that has created the signature
     */
    function verifyMultiSig(
        address toAddress,
        bytes32 operationHash,
        bytes memory signature,
        uint expireTime,
        uint sequenceId
    ) private returns (address) {

        address otherSigner = recoverAddressFromSignature(operationHash, signature);

        // Verify if we are in safe mode. In safe mode, the wallet can only send to signers
        require(!(safeMode && !isSigner(toAddress)), "In safeMode or not a signer");
        // Verify that the transaction has not expired

        require(expireTime >= block.timestamp, "Transaction expired");

        // Try to insert the sequence ID. Will revert if the sequence id was invalid
        tryInsertSequenceId(sequenceId);

        require(isSigner(otherSigner), "Argument otherSigner not match");

        // Cannot approve own transaction
        require (otherSigner != msg.sender, "Cann't approve own tx");

        return otherSigner;
    }

    /**
     * Irrevocably puts contract into safe mode. When in this mode, transactions may only be sent to signing addresses.
     */
    function activateSafeMode() public onlySigner {
        safeMode = true;
        emit SafeModeActivated(msg.sender);
    }

    /**
     * Gets signer's address using ecrecover
     * @param operationHash see Data Formats
     * @param signature see Data Formats
     * returns address recovered from the signature
     */
    function recoverAddressFromSignature(
        bytes32 operationHash,
        bytes memory signature
    ) private pure returns (address) {
        require(signature.length == 65, "Invalid signature length");
        // We need to unpack the signature, which is given as an array of 65 bytes (like eth.sign)
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            //v := and(mload(add(signature, 65)), 255)
            v := byte(0, mload(add(signature, 96)))
        }
        if (v < 27) {
            v += 27; // Ethereum versions are 27 or 28 as opposed to 0 or 1 which is submitted by some signing libs
        }

        return ecrecover(operationHash, v, r, s);
    }

    /**
     * Verify that the sequence id has not been used before and inserts it. Throws if the sequence ID was not accepted.
     * We collect a window of up to 10 recent sequence ids, and allow any sequence id that is not in the window and
     * greater than the minimum element in the window.
     * @param sequenceId to insert into array of stored ids
     */
    function tryInsertSequenceId(uint sequenceId) private onlySigner {
        // Keep a pointer to the lowest value element in the window
        uint lowestValueIndex = 0;
        for (uint i = 0; i < SEQUENCE_ID_WINDOW_SIZE; i++) {
            if (recentSequenceIds_[i] == sequenceId) {
                // This sequence ID has been used before. Disallow!
                revert();
            }
            if (recentSequenceIds_[i] < recentSequenceIds_[lowestValueIndex]) {
                lowestValueIndex = i;
            }
        }
        if (sequenceId < recentSequenceIds_[lowestValueIndex]) {
            // The sequence ID being used is lower than the lowest value in the window
            // so we cannot accept it as it may have been used before
            revert();
        }
        if (sequenceId > (recentSequenceIds_[lowestValueIndex] + 10000)) {
            // Block sequence IDs which are much higher than the lowest value
            // This prevents people blocking the contract by using very large sequence IDs quickly
            revert();
        }
        recentSequenceIds_[lowestValueIndex] = sequenceId;
    }

    /**
    * Gets the next available sequence ID for signing when using executeAndConfirm
    * returns the sequenceId one higher than the highest currently stored
     */
    function getNextSequenceId() public view returns (uint) {
        uint highestSequenceId = 0;
        for (uint i = 0; i < SEQUENCE_ID_WINDOW_SIZE; i++) {
            if (recentSequenceIds_[i] > highestSequenceId) {
                highestSequenceId = recentSequenceIds_[i];
            }
        }
        return highestSequenceId + 1;
    }
}
