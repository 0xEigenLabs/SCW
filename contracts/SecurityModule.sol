// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "./BaseModule.sol";
import "./IWallet.sol";
import "./IModuleRegistry.sol";

import "hardhat/console.sol";

contract SecurityModule is BaseModule, Initializable {
    //events
    event SMInited(address _wallet, bytes data);
    event SMParametarChanged(address _wallet, uint _lockedSecurityPeriod, uint _recoverySecurityPeriod);
    event SignerAdded(address _wallet, address signer);
    event SignerReplaced(address _wallet, address _newSigner, address _oldSigner);
    event SignerRemoved(address _wallet, address _oldSigner);
    event RecoveryTriggered(address _wallet, address _recovery);
    event RecoveryCancelled(address _wallet);
    event RecoveryExecuted(address _wallet);
    event Locked(address _wallet);
    event Unlocked(address _wallet);

    uint public recoverySecurityPeriod;  

    struct Recovery {
        uint activeAt; // timestamp for activation of escape mode, 0 otherwise
        address recovery;
    }
    mapping (address => Recovery) public recoveries;

    struct SignerConfInfo {
        address[] signers;
        bool exist;
        uint lockedPeriod;
        uint recoveryPeriod;
    }

    mapping (address => SignerConfInfo) public signerConfInfos;
    constructor() {}

    function initialize(
        IModuleRegistry _registry,
        uint _lockedSecurityPeriod,
        uint _recoverySecurityPeriod
    ) public initializer {
        registry = _registry;
        lockedSecurityPeriod = _lockedSecurityPeriod;
        recoverySecurityPeriod = _recoverySecurityPeriod;
    }

    function init(address _wallet, bytes memory data) public override onlyWallet(_wallet) {
        require(!isRegisteredWallet(_wallet), "SM: should not add same module to wallet twice");
        require(!signerConfInfos[_wallet].exist, "SM: wallet exists in signerConfInfos");

        addWallet(_wallet);
        // decode signer info from data
        (address[] memory signers) = abi.decode(data, (address[]));
        SignerConfInfo storage signerConfInfo = signerConfInfos[_wallet];
        // TODO make sure signers is empty
        for (uint i = 0; i < signers.length; i++) {
            signerConfInfo.signers.push(signers[i]);
            require(signers[i] != IWallet(_wallet).owner(), "SM: signer cann't be owner");
        }
        signerConfInfo.exist = true;
        signerConfInfo.lockedPeriod = lockedSecurityPeriod;
        signerConfInfo.recoveryPeriod = recoverySecurityPeriod;
        emit SMInited(_wallet, data);
    }

    function removeModule(address _wallet) public override onlyWallet(_wallet) {
        require(signerConfInfos[_wallet].exist, "SM: Invalid wallet");

        removeWallet(_wallet);
        delete signerConfInfos[_wallet];
    }

    function setSecurityPeriod(address _wallet, uint _lockedSecurityPeriod, uint _recoverySecurityPeriod) external onlyOwner(_wallet) onlyWhenUnlocked(_wallet) {
        SignerConfInfo storage signerConfInfo = signerConfInfos[_wallet];
        require(signerConfInfo.exist, "SM: Invalid wallet");
        require(signerConfInfo.lockedPeriod != _lockedSecurityPeriod || signerConfInfo.recoveryPeriod != _recoverySecurityPeriod, "SM:Must change at least one period");
        if (signerConfInfo.lockedPeriod != _lockedSecurityPeriod) {
            signerConfInfo.lockedPeriod = _lockedSecurityPeriod;
        }
        if (signerConfInfo.recoveryPeriod != _recoverySecurityPeriod) {
            signerConfInfo.recoveryPeriod = _recoverySecurityPeriod;
        }
        emit SMParametarChanged(_wallet, _lockedSecurityPeriod, _recoverySecurityPeriod);
    }

    function getLockedSecurityPeriod(address _wallet) public view returns (uint) {
        SignerConfInfo memory signerConfInfo = signerConfInfos[_wallet];
        require(signerConfInfo.exist, "SM: Invalid wallet");
        return signerConfInfo.lockedPeriod;
    }

    function getRecoverySecurityPeriod(address _wallet) public view returns (uint) {
        SignerConfInfo memory signerConfInfo = signerConfInfos[_wallet];
        require(signerConfInfo.exist, "SM: Invalid wallet");
        return signerConfInfo.recoveryPeriod;
    }

    function isSigner(address _wallet, address _signer) public view returns (bool) {
        SignerConfInfo memory signerConfInfo = signerConfInfos[_wallet];
        return findSigner(signerConfInfo.signers, _signer);
    }

    function getSigners(address _wallet) public view returns(address[] memory) {
        return signerConfInfos[_wallet].signers;
    }

    /**
     * @notice Helper method to check if a wallet is locked.
     * @param _wallet The target wallet.
     */
    function isLocked(address _wallet) public view returns (uint) {
        return _isLocked(_wallet);
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
    function addSigner(address _wallet, address signer) external onlyOwner(_wallet) onlyWhenUnlocked(_wallet) {
        require(isRegisteredWallet(_wallet), "SM: wallet should be registered before adding signers");
        require(signer != address(0) && !isSigner(_wallet, signer), "SM: invalid newSigner or invalid oldSigner");

        SignerConfInfo storage signerConfInfo = signerConfInfos[_wallet];
        require(signerConfInfo.exist, "SM: wallet signer info not consistent");
        signerConfInfo.signers.push(signer);
        signerConfInfos[_wallet] = signerConfInfo;
        // calm-down period
        _setLock(_wallet, block.timestamp + signerConfInfo.lockedPeriod, SecurityModule.addSigner.selector);
        emit SignerAdded(_wallet, signer);
    }

    function replaceSigner(address _wallet, address _newSigner, address _oldSigner) external onlyOwner(_wallet) onlyWhenUnlocked(_wallet) {
        require(isRegisteredWallet(_wallet), "SM: wallet should be registered before adding signers");
        require(_newSigner != address(0) && isSigner(_wallet, _oldSigner), "SM: invalid newSigner or invalid oldSigner");

        SignerConfInfo storage signerConfInfo = signerConfInfos[_wallet];
        require(signerConfInfo.exist, "SM: Invalid wallet");

        uint endIndex = signerConfInfo.signers.length - 1;
        for (uint i = 0; i < signerConfInfo.signers.length - 1; i ++) {
            if (_oldSigner == signerConfInfo.signers[i]) {
                signerConfInfo.signers[i] = _newSigner;
                i = endIndex;
            }
        }
        // calm-down period. Note that we use the addSigner Selector because we regard the lock action of add/replace/remove signer as the same class.
        _setLock(_wallet, block.timestamp + signerConfInfo.lockedPeriod, SecurityModule.addSigner.selector);
        emit SignerReplaced(_wallet, _newSigner, _oldSigner);
    }

    function removeSigner(address _wallet, address _oldSigner) external onlyOwner(_wallet) onlyWhenUnlocked(_wallet) {
        require(isRegisteredWallet(_wallet), "SM: wallet should be registered before adding signers");
        require(isSigner(_wallet, _oldSigner), "SM: invalid oldSigner");

        SignerConfInfo storage signerConfInfo = signerConfInfos[_wallet];
        require(signerConfInfo.exist, "SM: Invalid wallet");

        uint endIndex = signerConfInfo.signers.length - 1;
        address lastSigner = signerConfInfo.signers[endIndex];
        for (uint i = 0; i < signerConfInfo.signers.length - 1; i ++) {
            if (_oldSigner == signerConfInfo.signers[i]) {
                signerConfInfo.signers[i] = lastSigner;
                i = endIndex;
            }
        }
        signerConfInfo.signers.pop();
        // calm-down period. Note that we use the addSigner Selector because we regard the lock action of add/replace/remove signer as the same class.
        _setLock(_wallet, block.timestamp + signerConfInfo.lockedPeriod, SecurityModule.addSigner.selector);
        emit SignerRemoved(_wallet, _oldSigner);
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
        SignerConfInfo storage signerConfInfo = signerConfInfos[_wallet];
        _setLock(_wallet, block.timestamp + signerConfInfo.lockedPeriod, SecurityModule.triggerRecovery.selector);
        uint expiry = block.timestamp + signerConfInfo.recoveryPeriod;

        recoveries[_wallet] = Recovery({
            activeAt: expiry,
            recovery: _recovery
        });
        emit RecoveryTriggered(_wallet, _recovery);
    }

    function cancelRecovery(address _wallet) external onlyWallet(_wallet) {
        //require(recovery.activeAt != 0 && recovery.recovery != address(0), "not recovering");
        require(isInRecovery(_wallet), "SM: not recovering");
        delete recoveries[_wallet];
        _setLock(_wallet, 0, bytes4(0));
        emit RecoveryCancelled(_wallet);
    }

    function executeRecovery(address _wallet) public {
        require(
            isInRecovery(_wallet),
            "SM: No valid recovery found"
        );
        Recovery memory recovery_ = recoveries[_wallet];

        IWallet(_wallet).replaceOwner(recovery_.recovery);

        delete recoveries[_wallet];
        _setLock(_wallet, 0, bytes4(0));
        emit RecoveryExecuted(_wallet);
    }

    /**
     * @notice Lets a guardian lock a wallet. FIXME owner can also lock
     * @param _wallet The target wallet.
     */
    function lock(address _wallet) external onlyOwnerOrSigner(_wallet) onlyWhenUnlocked(_wallet) {
        SignerConfInfo storage signerConfInfo = signerConfInfos[_wallet];
        _setLock(_wallet, block.timestamp + signerConfInfo.lockedPeriod, SecurityModule.lock.selector);
        emit Locked(_wallet);
    }

    /**
     * @notice Lets a guardian unlock a locked wallet. FIXME owner can also unlock
     * @param _wallet The target wallet.
     */
    function unlock(address _wallet) external onlyOwnerOrSigner(_wallet) onlyWhenLocked(_wallet) {
        require(locks[_wallet].locker == SecurityModule.lock.selector, "SM: cannot unlock");
        _setLock(_wallet, 0, bytes4(0));
        emit Unlocked(_wallet);
    }

    /**
     * @notice Only entry point of the multisig. The method will execute any transaction provided that it
     * receieved enough signatures from the wallet owners.
     * @param _wallet The destination address for the transaction to execute.
     * @param _args The value parameter for the transaction to execute.
     * @param _signatures Concatenated signatures ordered based on increasing signer's address.
     */
    function multicall(address _wallet, CallArgs memory _args, bytes memory _signatures) public onlyOwnerOrSigner(_wallet) {
        SignerConfInfo storage signerConfInfo = signerConfInfos[_wallet];
        require(signerConfInfo.exist, "SM: invalid wallet");
        uint threshold = (signerConfInfo.signers.length + 1) / 2;
        uint256 count = _signatures.length / 65;
        require(count >= threshold, "SM: Not enough signatures");
        bytes32 txHash = getHash(_args);
        uint256 valid = 0;
        address lastSigner = address(0);
        for (uint256 i = 0; i < count; i++) {
            address recovered = recoverSigner(txHash, _signatures, i);
            require(recovered > lastSigner, "SM: Badly ordered signatures"); // make sure signers are different
            lastSigner = recovered;
            if (findSigner(signerConfInfo.signers, recovered)) {
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

    function getHash(CallArgs memory _args) internal pure returns(bytes32) {
        address to = _args.to;
        uint value = _args.value;
        bytes memory data = _args.data;
        uint sequenceId = _args.sequenceId;

        //TODO encode expire time
        return keccak256(abi.encodePacked(bytes1(0x19), bytes1(0), to, value, data, sequenceId));
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
