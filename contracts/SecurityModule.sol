// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.6.11;

import "@openzeppelin/contracts/utils/SafeCast.sol";
import "./BaseModule.sol";
import "./IWallet.sol";
import "./IModuleRegistry.sol";

contract SecurityModule is BaseModule {

    uint constant RECOVERY_SECURITY_PERIOD = 120;
    uint constant LOCKED_SECURITY_PERIOD = 120;

    struct Recovery {
        uint activeAt; // timestamp for activation of escape mode, 0 otherwise
        address recovery;
        address removed;
        uint index;
    }

    address[] wallets;
    mapping (address => Recovery) public recoveries;
    // TODO
    //address[] wallets;

    struct Lock {
        // the lock's release timestamp
        uint releaseAt;
        // the signature of the method that set the last lock
        bytes4 locker;
    }

    constructor(IModuleRegistry _registry) public {
        registry = _registry;
    }

    function init(address _wallet)  public override {
    }

    /**
     * add new module to wallet
     * @param _wallet attach module to new module
     * @param _module attach module
     */
    function addModule(address _wallet, address _module) external override onlySelf onlyWhenUnlocked(_wallet) {
        require(registry.isRegisteredModule(_module), "AM: module is not registered");
        IWallet(_wallet).authoriseModule(_module, true);
    }

    /**
     * @notice Throws if the recovery is not a guardian for the wallet or the module itself.
     */
    modifier OnlyWalletOrSigner(address _wallet) {
        require(
            IWallet(_wallet).authorised(address(this)) || IWallet(_wallet).isSigner(msg.sender),
            "SM: must be signer/wallet"
        );
        _;
    }

    //social recovery

    // Wallet specific lock storage
    mapping (address => Lock) internal locks;

    function isInRecovery(address _wallet) public view returns (bool) {
        Recovery memory config = recoveries[_wallet];
        return config.activeAt != 0 && config.activeAt > uint64(block.timestamp);
    }

    function foo(address a, uint256 b) external OnlyWalletOrSigner(a) {
    }

    // social recover
    /**
     * Declare a recovery, executed by contract itself, called by sendMultiSig.
     * @param _recovery: lost signer
     */
    function triggerRecovery(address _wallet, address _recovery, address _removed) external OnlyWalletOrSigner(_wallet) {
        require(IWallet(_wallet).isSigner(_removed), "TR: invalid _removed signer");
        require(_recovery != address(0), "TR: Invalid new signer");
        require(
            !isInRecovery(_wallet),
            "TR: should not trigger twice"
        );
        _setLock(_wallet, block.timestamp + LOCKED_SECURITY_PERIOD, SecurityModule.triggerRecovery.selector);
        uint res = block.timestamp + 1 hours;

        //index
        Recovery memory config = recoveries[_wallet];
        uint index = wallets.length;
        if (config.activeAt != 0) {
            index = config.index;
        }

        recoveries[_wallet] = Recovery({
            activeAt: res,
            recovery: _recovery,
            removed: _removed,
            index: index
        });
    }

    function cancelRecovery(address _wallet) external OnlyWalletOrSigner(_wallet) {
        //require(recovery.activeAt != 0 && recovery.recovery != address(0), "not recovering");
        require(isInRecovery(_wallet), "CR: not recovering");
        address last = wallets[wallets.length - 1];
        if (last != _wallet) {
            uint targetIndex = recoveries[_wallet].index;
            wallets[targetIndex] = last;
            recoveries[last].index = targetIndex;
        }
        wallets.pop();
        delete recoveries[_wallet];
        _setLock(_wallet, 0, bytes4(0));
    }

    function executeRecovery(address _wallet) external OnlyWalletOrSigner(_wallet) {
        require(
            isInRecovery(_wallet),
            "ER: No valid recovery found"
        );
        Recovery memory recovery_ = recoveries[_wallet];
        IWallet(_wallet).replaceSigner(recovery_.recovery, recovery_.removed);

        address last = wallets[wallets.length - 1];
        if (last != _wallet) {
            uint targetIndex = recoveries[_wallet].index;
            wallets[targetIndex] = last;
            recoveries[last].index = targetIndex;
        }
        wallets.pop();
        delete recoveries[_wallet];
        _setLock(_wallet, 0, bytes4(0));
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
        return locks[_wallet].releaseAt > block.timestamp;
    }

     /**
     * @notice Lets a guardian lock a wallet. FIXME owner can also lock
     * @param _wallet The target wallet.
     */
    function lock(address _wallet) external OnlyWalletOrSigner(_wallet) onlyWhenUnlocked(_wallet) {
        _setLock(_wallet, block.timestamp + LOCKED_SECURITY_PERIOD, SecurityModule.lock.selector);
    }

    /**
     * @notice Lets a guardian unlock a locked wallet. FIXME owner can also unlock
     * @param _wallet The target wallet.
     */
    function unlock(address _wallet) external OnlyWalletOrSigner(_wallet) onlyWhenLocked(_wallet) {
        require(locks[_wallet].locker == SecurityModule.lock.selector, "SM: cannot unlock");
        _setLock(_wallet, 0, bytes4(0));
    }

    function _setLock(address _wallet, uint256 _releaseAfter, bytes4 _locker) internal {
        locks[_wallet] = Lock(_releaseAfter, _locker);
    }
}
