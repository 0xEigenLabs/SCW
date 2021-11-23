// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.6.11;

import "@openzeppelin/contracts/utils/SafeCast.sol";
import "./BaseModule.sol";
import "./GuardiansStorage.sol";
import "./IWallet.sol";

contract SecurityModule is BaseModule {

    uint constant RECOVERY_SECURITY_PERIOD = 120;
    uint constant LOCKED_SECURITY_PERIOD = 120;

    struct Recovery {
        uint64 activeAt; // timestamp for activation of escape mode, 0 otherwise
        address caller;
        address removed;
    }

    struct Lock {
        // the lock's release timestamp
        uint64 releaseAt;
        // the signature of the method that set the last lock
        bytes4 locker;
    }

    // TODO
    function init(address _wallet) external override onlySelf {
    }

    /**
     */
    function addModule(address _wallet, address _module) external override onlySelf onlyWhenUnlocked(_wallet) {
        // TODO check if the module existing
        IWallet(_wallet).authoriseModule(_module, true);
    }

    /**
     * @notice Throws if the caller is not a guardian for the wallet or the module itself.
     */
    modifier onlyGuardianOrSelf(address _wallet) {
        require(_isSelf(msg.sender) || guardianStorage_.isGuardian(_wallet, msg.sender), "SM: must be signer/self");
        _;
    }

    //social recovery
    Recovery internal recovery_;
    GuardiansStorage internal guardianStorage_;

    // Wallet specific lock storage
    mapping (address => Lock) internal locks;

    // social recover
    /**
     * Declare a recovery, executed by contract itself, called by sendMultiSig.
     * @param _recovery: lost signer
     */
    function triggerRecovery(address _wallet, address _recovery, address _removed) external onlySelf {
        require(guardianStorage_.isGuardian(_wallet, _recovery), "invalid _recovery");

        if (recovery_.activeAt != 0 && recovery_.activeAt > uint64(block.timestamp)) {
            require(guardianStorage_.isGuardian(_wallet, recovery_.caller), "invalid recovery.caller");
            require(recovery_.caller != _recovery, "Should not repeatly recovery");
        }

        _setLock(_wallet, block.timestamp + LOCKED_SECURITY_PERIOD, SecurityModule.triggerRecovery.selector);
        recovery_ = Recovery(uint64(block.timestamp + RECOVERY_SECURITY_PERIOD), _recovery, _removed);
    }

    function cancelRecovery(address _wallet) external onlySelf {
        //require(recovery.activeAt != 0 && recovery.caller != address(0), "not recovering");
        require(recovery_.activeAt <= uint64(block.timestamp), "not recovering");
        delete recovery_;
        _setLock(_wallet, 0, bytes4(0));
    }

    function executeRecovery(address _wallet) external onlySelf {
        require(recovery_.activeAt <= uint64(block.timestamp), "No valid recovery found");
        require(isGuardian(_wallet, recovery_.caller), "Invalid guardian to recovery");
        IWallet(_wallet).replaceSigner(_wallet, recovery_.caller);
        _setLock(_wallet, 0, bytes4(0));
    }

    function addGuardian(address _wallet, address _guardian) external onlySelf onlyWhenUnlocked(_wallet) {
        guardianStorage_.addGuardian(_wallet, _guardian);
    }

    function revokeGuardian(address _wallet, address _guardian) external onlySelf onlyWhenUnlocked(_wallet) {
        require(isGuardian(_wallet, _guardian), "SM: must be existing guardian");
        guardianStorage_.revokeGuardian(_wallet, _guardian);
    }

    function isGuardian(address _wallet, address _guardian) public view returns (bool _isGuardian) {
        return guardianStorage_.isGuardian(_wallet, _guardian);
    }

    function guardianCount(address _wallet) external view returns (uint256 _count) {
        return guardianStorage_.guardianCount(_wallet);
    }

    function getGuardians(address _wallet) external view returns (address[] memory _guardians) {
        return guardianStorage_.getGuardians(_wallet);
    }

    // lock
     /**
     * @notice Throws if the wallet is not locked.
     */
    modifier onlyWhenLocked(address _wallet) {
        require(_isLocked(_wallet), "BM: wallet must be locked");
        _;
    }

    /**
     * @notice Throws if the wallet is locked.
     */
    modifier onlyWhenUnlocked(address _wallet) {
        require(!_isLocked(_wallet), "BM: wallet locked");
        _;
    }

    /**
     * @notice Helper method to check if a wallet is locked.
     * @param _wallet The target wallet.
     */
    function _isLocked(address _wallet) internal view returns (bool) {
        return locks[_wallet].releaseAt > uint64(block.timestamp);
    }

     /**
     * @notice Lets a guardian lock a wallet. FIXME owner can also lock
     * @param _wallet The target wallet.
     */
    function lock(address _wallet) external onlyGuardianOrSelf(_wallet) onlyWhenUnlocked(_wallet) {
        _setLock(_wallet, block.timestamp + LOCKED_SECURITY_PERIOD, SecurityModule.lock.selector);
    }

    /**
     * @notice Lets a guardian unlock a locked wallet. FIXME owner can also unlock
     * @param _wallet The target wallet.
     */
    function unlock(address _wallet) external onlyGuardianOrSelf(_wallet) onlyWhenLocked(_wallet) {
        require(locks[_wallet].locker == SecurityModule.lock.selector, "SM: cannot unlock");
        _setLock(_wallet, 0, bytes4(0));
    }

    function _setLock(address _wallet, uint256 _releaseAfter, bytes4 _locker) internal {
        locks[_wallet] = Lock(SafeCast.toUint64(_releaseAfter), _locker);
    }
}
