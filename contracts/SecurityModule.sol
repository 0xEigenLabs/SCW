// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.6.11;
pragma experimental ABIEncoderV2;

//import "@openzeppelin/contracts/utils/SafeCast.sol";
import "./BaseModule.sol";
import "./IWallet.sol";
import "./IModuleRegistry.sol";

contract SecurityModule is BaseModule {

    uint constant RECOVERY_SECURITY_PERIOD = 120;
    uint constant LOCKED_SECURITY_PERIOD = 120;
    event MultiCalled(address to, uint value, bytes data);

    struct Recovery {
        uint activeAt; // timestamp for activation of escape mode, 0 otherwise
        address recovery;
    }
    mapping (address => Recovery) public recoveries;

    struct SignerInfo {
        address[] signers;
        uint threshold;
        bool exist;
    }

    struct CallArgs {
        address to;
        uint value;
        bytes data;
        uint sequenceId;
        uint expireTime;
    }

    mapping (address => SignerInfo) public signerInfos;

    constructor(IModuleRegistry _registry) public {
        registry = _registry;
    }

    function init(address _wallet, bytes memory data)  public override onlyWallet(_wallet) {
        require(!isRegisteredWallet(_wallet), "SM: should not add same module to wallet twice");
        require(!signerInfos[_wallet].exist, "SM: wallet exists in signerInfos");

        addWallet(_wallet);
        // decode signer info from data
        (address[] memory signers, uint threshold) = abi.decode(data, (address[], uint));
        SignerInfo storage signerInfo = signerInfos[_wallet];
        for (uint i = 0; i < signers.length; i++) {
            signerInfo.signers.push(signers[i]);
            require(signers[i] != IWallet(_wallet).owner(), "SM: signer cann't be owner");
        }
        signerInfo.threshold = threshold;
        signerInfo.exist = true;
    }

    /**
     * add new module to wallet
     * @param _wallet attach module to new module
     * @param _module attach module
     */
    function addModule(address _wallet, address _module, bytes calldata data) external virtual override onlyWallet(_wallet) onlyWhenUnlocked(_wallet) {
        require(registry.isRegisteredModule(_module), "SM: module is not registered");
        IWallet(_wallet).authoriseModule(_module, true, data);
    }

    function isSigner(address _wallet, address _signer) public view returns (bool) {
        SignerInfo storage signerInfo = signerInfos[_wallet];
        return findSigner(signerInfo.signers, _signer);
    }

    function findSigner(address[] memory _signers, address _signer) public pure returns (bool) {
        for (uint i = 0; i < _signers.length; i ++) {
            if (_signers[i] == _signer) {
                return true;
            }
        }
        return false;
    }

    /**
     * @notice Throws if the recovery is not a guardian for the wallet or the module itself.
     */
    modifier onlyOwnerOrSigner(address _wallet) {
        require(
            IWallet(_wallet).owner() == msg.sender || isSigner(_wallet, msg.sender),
            "SM: must be signer/wallet"
        );
        _;
    }

    // signer managerment
    function addSigner(address _wallet, address[] memory signer) public onlyOwner(_wallet) {
        require(isRegisteredWallet(_wallet), "SM: wallet should be registered before adding signers");
        require(signer.length > 0, "SM: invalid signers number");

        SignerInfo storage signerInfo = signerInfos[_wallet];
        require(signerInfo.exist, "SM: wallet signer info not consistent");
        for (uint i = 0; i < signer.length; i ++) {
            signerInfo.signers.push(signer[i]);
        }
        signerInfos[_wallet] = signerInfo;
    }

    function replaceSigner(address _wallet, address _newSigner, address _oldSigner) public onlyOwner(_wallet) {
        require(isRegisteredWallet(_wallet), "SM: wallet should be registered before adding signers");
        require(_newSigner != address(0) && isSigner(_wallet, _oldSigner), "SM: invalid newSigner or invalid oldSigner");

        SignerInfo storage signerInfo = signerInfos[_wallet];
        require(signerInfo.exist, "SM: Invalid wallet");

        uint endIndex = signerInfo.signers.length - 1;
        for (uint i = 0; i < signerInfo.signers.length - 1; i ++) {
            if (_oldSigner == signerInfo.signers[i]) {
                signerInfo.signers[i] = _newSigner;
                i = endIndex;
            }
        }
        // emit event
    }

    // social recovery
    function isInRecovery(address _wallet) public view returns (bool) {
        Recovery memory config = recoveries[_wallet];
        return config.activeAt != 0 && config.activeAt > uint64(block.timestamp);
    }

    /**
     * Declare a recovery, executed by contract itself, called by sendMultiSig.
     * @param _recovery: lost signer
     */
    function triggerRecovery(address _wallet, address _recovery) external onlyWallet(_wallet) {
        require(_recovery != address(0), "SM: Invalid new signer");
        require(_recovery != IWallet(_wallet).owner(), "SM: owner can not trigger a recovery");
        require(!isSigner(_wallet, _recovery), "SM: newOwner can't be an existing signer");
        require(
            !isInRecovery(_wallet),
            "SM: should not trigger twice"
        );
        _setLock(_wallet, block.timestamp + LOCKED_SECURITY_PERIOD, SecurityModule.triggerRecovery.selector);
        uint expiry = block.timestamp + 1 hours;

        recoveries[_wallet] = Recovery({
            activeAt: expiry,
            recovery: _recovery
        });
    }

    function cancelRecovery(address _wallet) external onlyWallet(_wallet) {
        //require(recovery.activeAt != 0 && recovery.recovery != address(0), "not recovering");
        require(isInRecovery(_wallet), "SM: not recovering");
        delete recoveries[_wallet];
        _setLock(_wallet, 0, bytes4(0));
    }

    function executeRecovery(address _wallet) external onlyWallet(_wallet) {
        require(
            isInRecovery(_wallet),
            "SM: No valid recovery found"
        );
        Recovery memory recovery_ = recoveries[_wallet];
        require (msg.sender != recovery_.recovery, "SM: recovery executor mustn't be caller");

        IWallet(_wallet).replaceOwner(recovery_.recovery);

        delete recoveries[_wallet];
        _setLock(_wallet, 0, bytes4(0));
    }

    /**
     * @notice Lets a guardian lock a wallet. FIXME owner can also lock
     * @param _wallet The target wallet.
     */
    function lock(address _wallet) external onlyWallet(_wallet) onlyWhenUnlocked(_wallet) {
        _setLock(_wallet, block.timestamp + LOCKED_SECURITY_PERIOD, SecurityModule.lock.selector);
    }

    /**
     * @notice Lets a guardian unlock a locked wallet. FIXME owner can also unlock
     * @param _wallet The target wallet.
     */
    function unlock(address _wallet) external onlyWallet(_wallet) onlyWhenLocked(_wallet) {
        require(locks[_wallet].locker == SecurityModule.lock.selector, "SM: cannot unlock");
        _setLock(_wallet, 0, bytes4(0));
    }

    function _setLock(address _wallet, uint256 _releaseAfter, bytes4 _locker) internal {
        locks[_wallet] = Lock(uint64(_releaseAfter), _locker);
    }

    /**
     * @notice Only entry point of the multisig. The method will execute any transaction provided that it
     * receieved enough signatures from the wallet owners.
     * @param _wallet The destination address for the transaction to execute.
     * @param _args The value parameter for the transaction to execute.
     * @param _signatures Concatenated signatures ordered based on increasing signer's address.
     */
    function multicall(address _wallet, CallArgs memory _args, bytes memory _signatures) public onlyOwnerOrSigner(_wallet) {
        SignerInfo storage signerInfo = signerInfos[_wallet];
        require(signerInfo.exist, "SM: invalid wallet");
        uint threshold = signerInfo.threshold;
        uint256 count = _signatures.length / 65;
        require(count >= threshold, "SM: Not enough signatures");
        bytes32 txHash = getHash(_wallet, _args);
        uint256 valid = 0;
        address lastSigner = address(0);
        for (uint256 i = 0; i < count; i++) {
            address recovered = recoverSigner(txHash, _signatures, i);
            require(recovered > lastSigner, "SM: Badly ordered signatures"); // make sure signers are different
            lastSigner = recovered;
            if (findSigner(signerInfo.signers, recovered)) {
                valid += 1;
                if (valid >= threshold) {
                    execute(_wallet, _args);
                    return;
                }
            }
        }
        // If not enough signatures for threshold, then the transaction is not executed
        revert("SM: Not enough valid signatures");
    }

    function getHash(address _wallet, CallArgs memory _args) internal returns(bytes32) {
        address to = _args.to;
        uint value = _args.value;
        bytes memory data = _args.data;
        uint sequenceId = _args.sequenceId;

        //TODO encode expire time
        return keccak256(abi.encodePacked(bytes1(0x19), bytes1(0), to, value, data, sequenceId));
    }

    function execute(address _wallet, CallArgs memory _args) internal {
        address to = _args.to;
        uint value = _args.value;
        bytes memory data = _args.data;
        uint sequenceId = _args.sequenceId;
        uint expireTime = _args.expireTime;

        IWallet(_wallet).invoke(to, value, data, expireTime, sequenceId);
        emit MultiCalled(to, value, data);
    }

    function recoverSigner(bytes32 txHash, bytes memory _signatures, uint256 _i) internal pure returns (address){
        uint8 v;
        bytes32 r;
        bytes32 s;
        (v,r,s) = splitSignature(_signatures, _i);
        return ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32",txHash)), v, r, s);
    }

    /**
     * @notice Parses the signatures and extract (r, s, v) for a signature at a given index.
     * A signature is {bytes32 r}{bytes32 s}{uint8 v} in compact form where the signatures are concatenated.
     * @param _signatures concatenated signatures
     * @param _index which signature to read (0, 1, 2, ...)
     */
    function splitSignature(bytes memory _signatures, uint256 _index) internal pure returns (uint8 v, bytes32 r, bytes32 s) {
        // we jump 32 (0x20) as the first slot of bytes contains the length
        // we jump 65 (0x41) per signature
        // for v we load 32 bytes ending with v (the first 31 come from s) tehn apply a mask
        assembly {
            r := mload(add(_signatures, add(0x20,mul(0x41,_index))))
            s := mload(add(_signatures, add(0x40,mul(0x41,_index))))
            v := and(mload(add(_signatures, add(0x41,mul(0x41,_index)))), 0xff)
        }
        require(v == 27 || v == 28, "SM: Invalid v");
    }
}
