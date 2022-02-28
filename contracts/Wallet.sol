// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import "./Forwarder.sol";
import "./BaseModule.sol";
import "./IWallet.sol";

import "hardhat/console.sol";

contract Wallet is IWallet, Initializable {
    // Events
    event Deposited(address from, uint value, bytes data);
    event SafeModeActivated(address msgSender);
    event AuthorisedModule(address indexed module, bool value);
    event Received(uint indexed value, address indexed sender, bytes data);
    event Invoked(address from, address to, uint value, bytes data);
    event RawInvoked(address from, address to, uint value, bytes data);
    event OwnerReplaced(address _newOwner);

    // Public fields
    address public override owner;
    uint public override modules;

    // Internal fields
    uint constant SEQUENCE_ID_WINDOW_SIZE = 10;
    uint[10] recentSequenceIds_;

     // The authorised modules
    mapping (address => bool) public override authorised;

     /**
     * @notice Throws if the sender is not an authorised module.
     */
    modifier onlyModule {
        require(authorised[msg.sender], "W: must be module");
        _;
    }
    modifier onlyModuleOrOwner {
        require(authorised[msg.sender] || msg.sender == owner, "W: must be owner or module");
        _;
    } 

    modifier onlyOwner {
        require(msg.sender == owner, "W: must be owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * Set up a simple multi-sig wallet by specifying the signers allowed to be used on this wallet.
     * 2 signers will be required to send a transaction from this wallet.
     * Note: The sender is NOT automatically added to the list of signers.
     * Signers CANNOT be changed once they are set
     *
     * @param _modules All modules to authrized by wallet
     * @param _data All modules to authrized by wallet
     */
    function initialize(address[] calldata _modules, bytes[] calldata _data) public initializer {
        require(owner == address(0), "W: wallet already initialized");
        require(_modules.length > 0 && _modules.length == _data.length, 
                "W: empty modules or not matched data");
        modules = _modules.length;
        owner = msg.sender;
        for (uint256 i = 0; i < _modules.length; i++) {
            require(authorised[_modules[i]] == false, "Module is already added");
            authorised[_modules[i]] = true;
            console.log("initialize");
            console.log(address(this));
            IModule(_modules[i]).init(address(this), _data[i]);  // uncomment will make test/proxy.test.ts failed
            emit AuthorisedModule(_modules[i], true);
        }
        if (address(this).balance > 0) {
            emit Received(address(this).balance, address(0), "");
        }
    }

    /**
     * Upgrade model or remove model for wallet
     * @notice TODO @czl only multiple signature access this. This indicates that SecurityModule is a must
     */
    function authoriseModule(address _module, bool _value, bytes calldata _data) external override onlyOwner {
        if (authorised[_module] != _value) {
            emit AuthorisedModule(_module, _value);
            if (_value == true) {
                modules += 1;
                authorised[_module] = true;
                console.log("authoriseModule");
                console.log(address(this));
                IModule(_module).init(address(this), _data);
            } else {
                modules -= 1;
                require(modules > 0, "BW: cannot remove last module");
                //TODO @czl clean the wallet from this module
                delete authorised[_module];
            }
        }
    }

    function replaceOwner(address _newOwner) external override onlyModule {
        require(_newOwner != address(0), "W: invalid newOwner");
        owner = _newOwner;
        emit OwnerReplaced(_newOwner);
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
     * Verify that the sequence id has not been used before and inserts it. Throws if the sequence ID was not accepted.
     * We collect a window of up to 10 recent sequence ids, and allow any sequence id that is not in the window and
     * greater than the minimum element in the window.
     * @param sequenceId to insert into array of stored ids
     */
    function tryInsertSequenceId(uint sequenceId) internal {
        // Keep a pointer to the lowest value element in the window
        uint lowestValueIndex = 0;
        for (uint i = 0; i < SEQUENCE_ID_WINDOW_SIZE; i++) {
            // This sequence ID has been used before. Disallow!
            require (recentSequenceIds_[i] != sequenceId, "W: the sequence ID has been used");
            if (recentSequenceIds_[i] < recentSequenceIds_[lowestValueIndex]) {
                lowestValueIndex = i;
            }
        }
        // The sequence ID being used is lower than the lowest value in the window
        // so we cannot accept it as it may have been used before
        require(sequenceId >= recentSequenceIds_[lowestValueIndex],
                "W: the sequence ID being used is lower thatn the lowest value");

        // Block sequence IDs which are much higher than the lowest value
        // This prevents people blocking the contract by using very large sequence IDs quickly
        require(sequenceId <= (recentSequenceIds_[lowestValueIndex] + 10000),
                "W: block sequnece ID are much higer than the lowest value");
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

    /**
     * @notice Performs a generic transaction.
     * @param _target The address for the transaction.
     * @param _value The value of the transaction.
     * @param _data The data of the transaction.
     * @param _expireTime The data of the transaction.
     * @param _sequenceId The data of the transaction.
     */
    function invoke(address _target, uint _value, bytes calldata _data,
                    uint _expireTime, uint _sequenceId
                   ) external override onlyModule returns (bytes memory _result) {
        require(_target != address(this), "W: cann't call itself");
        bool success;
        require(_expireTime >= block.timestamp, "Transaction expired");

        tryInsertSequenceId(_sequenceId);
        (success, _result) = _target.call{value: _value}(_data);
        if (!success) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }
        emit Invoked(msg.sender, _target, _value, _data);
    }

    function raw_invoke(address _target, uint _value, bytes calldata _data
                   ) external override onlyModule returns (bytes memory _result) {
        require(_target != address(this), "W: cann't call itself");
        bool success;
        (success, _result) = _target.call{value: _value}(_data);
        if (!success) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }
        emit RawInvoked(msg.sender, _target, _value, _data);
    }
}
