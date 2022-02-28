// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

import "./IModule.sol";
import "./IWallet.sol";
import "./IModuleRegistry.sol";

import "hardhat/console.sol";

abstract contract BaseModule is IModule {

    event MultiCalled(address to, uint value, bytes data);
    IModuleRegistry internal registry;
    address[] internal wallets;
    struct Lock {
        // the lock's release timestamp
        uint64 release;
        // the signature of the method that set the last lock
        bytes4 locker;
    }

    /*
     * We classify three kinds of selectors used in _setLock to distinguish different types of locks:
     * 1.SignerSelector is calculated from SecurityModule.addSigner.selector, representing the locks added by these three functions: 
     * addSigner, replaceSigner and removeSigner.
     * 2.TransactionSelector is calculated from TransactionModule.executeLargeTransaction.selector, representing the lock added by executeLargeTransaction.
     * 3.GlobalSelector is calculated from SecurityModule.lock.selector, representing the lock added by lock.
     * The difference between 3 and 1&2 is that when users trigger SecurityModule's lock funtion, they want to actively lock, 
     * but when they triggered addSigner, replaceSigner, removeSigner or executeLargeTransaction, the wallet is locked because 
     * We don't want users to trigger these actions too often for security reasons.
     */
    bytes4 internal constant SignerSelector = 0x2239f556;
    bytes4 internal constant TransactionSelector = 0x8279b062;
    bytes4 internal constant GlobalSelector = 0xf435f5a7;

    // Wallet specific lock storage
    mapping (address => Lock) internal locks;

    struct CallArgs {
        address to;
        uint value;
        bytes data;
        uint sequenceId;
        uint expireTime;
    }

    // default value of lockedPeriod, used for the inherited modules when they need to setlock
    uint internal lockedSecurityPeriod;

    /**
     * @notice Lock the wallet
     */
    function _setLock(address _wallet, uint256 _releaseAfter, bytes4 _locker) internal {
        locks[_wallet] = Lock(uint64(_releaseAfter), _locker);
    }


    /**
     * Modifier that will check if sender is owner
     */
    modifier onlySelf() {
        require(msg.sender == address(this), "only self");
        _;
    }

    function _isSelf(address _self) internal view returns (bool) {
        return _self == address(this);
    }

     /**
     * @notice Throws if the wallet is not locked.
     */
    modifier onlyWhenLocked(address _wallet) {
        require(_isLocked(_wallet) != 0, "BM: wallet must be locked");
        _;
    }

    /**
     * @dev Throws if the sender is not the target wallet of the call.
     */
    modifier onlyWallet(address _wallet) {
        require(msg.sender == _wallet, "BM: caller must be wallet");
        _;
    }

    /**
     * @notice Helper method to check if a wallet is locked.
     * @param _wallet The target wallet.
     */
    function _isLocked(address _wallet) internal view returns (uint) {
        if (locks[_wallet].release > uint64(block.timestamp) && locks[_wallet].locker == SignerSelector) {
            // locked by SecurityModule.addSigner/replaceSigner/removeSigner
            return 1;
        } else if (locks[_wallet].release > uint64(block.timestamp) && locks[_wallet].locker == TransactionSelector) {
            // locked by TransactionModule.executeLargeTransaction
            return 2;
        } else if (locks[_wallet].release > uint64(block.timestamp) && locks[_wallet].locker == GlobalSelector) {
            // locked by SecurityModule.lock
            return 3;
        } 
        return 0;
    }

    /**
     * @notice Throws if the wallet is locked.
     */
    modifier onlyWhenUnlocked(address _wallet) {
        require(_isLocked(_wallet) == 0, "BM: wallet locked");
        _;
    }

    /**
     * @notice Throws if the wallet is locked globally.
     */      
    modifier onlyWhenNonGloballyLocked(address _wallet) {
        require(_isLocked(_wallet) != 3, "BM:wallet locked globally");
        _;
    }

    function isRegisteredWallet(address _wallet) internal view returns (bool){
        for (uint i = 0; i < wallets.length; i++) {
            if ( wallets[i] == _wallet ) {
                return true;
            }
        }
        return false;
    }

    /**
     * @notice Helper method to check if an address is the owner of a target wallet.
     * @param _wallet The target wallet.
     * @param _addr The address.
     */
    function _isOwner(address _wallet, address _addr) internal view returns (bool) {
        return IWallet(_wallet).owner() == _addr;
    }

    modifier onlyOwner(address _wallet) {
        require(IWallet(_wallet).owner() == msg.sender, "BM: must be owner");
        _;
    }

    function addWallet(address _wallet) internal {
        // duplicate check
        require(!isRegisteredWallet(_wallet), "BM: wallet already registered");
        wallets.push(_wallet); 
    }

    function removeWallet(address _wallet) internal {
        uint endIndex = wallets.length - 1;
        for (uint i = 0; i < endIndex; i ++) {
            if ( wallets[i] == _wallet ) {
                wallets[i] = wallets[endIndex];
                i = endIndex;
            }
        }
        wallets.pop();
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
}
