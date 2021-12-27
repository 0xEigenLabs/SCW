// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

import "./IModule.sol";
import "./IWallet.sol";
import "./IModuleRegistry.sol";

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

    // Wallet specific lock storage
    mapping (address => Lock) internal locks;

    struct CallArgs {
        address to;
        uint value;
        bytes data;
        uint sequenceId;
        uint expireTime;
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
        require(_isLocked(_wallet), "BM: wallet must be locked");
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
    function _isLocked(address _wallet) internal view returns (bool) {
        return locks[_wallet].release > uint64(block.timestamp);
    }

    /**
     * @notice Throws if the wallet is locked.
     */
    modifier onlyWhenUnlocked(address _wallet) {
        require(!_isLocked(_wallet), "BM: wallet locked");
        _;
    }

    function isRegisteredWallet(address _wallet) internal view returns (bool){
        for (uint i = 0; i < wallets.length; i ++) {
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
        require(IWallet(_wallet).owner() == msg.sender, "SM: must be owner");
        _;
    }

    function addWallet(address _wallet) internal {
        wallets.push(_wallet);
    }

    function removeWallet(address _wallet) internal {
        uint endIndex = wallets.length - 1;
        for (uint i = 0; i < wallets.length - 1; i ++) {
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
