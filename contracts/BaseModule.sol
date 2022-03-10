// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

import "./IModule.sol";
import "./IWallet.sol";
import "./IModuleRegistry.sol";


abstract contract BaseModule is IModule {

    event MultiCalled(address to, uint value, bytes data);
    IModuleRegistry internal registry;
    address[] internal wallets;

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
        require(IWallet(_wallet).isLocked() != 0, "BM: wallet must be locked");
        _;
    }

    /**
     * @notice Throws if the wallet is not globally locked.
     */
    modifier onlyWhenGloballyLocked(address _wallet) {
        uint lockFlag = IWallet(_wallet).isLocked();
        require(lockFlag % 2 == 1, "BM: wallet must be globally locked");
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
     * @notice Throws if the wallet is locked.
     */
    modifier onlyWhenUnlocked(address _wallet) {
        require(IWallet(_wallet).isLocked() == 0, "BM: wallet locked");
        _;
    }

    /**
     * @notice Throws if the wallet is locked globally.
     */      
    modifier onlyWhenNonGloballyLocked(address _wallet) {
        uint lockFlag = IWallet(_wallet).isLocked();
        require(lockFlag % 2 == 0, "BM: wallet locked globally");
        _;
    }

    /**
     * @notice Throws if the wallet is locked by signer related operation.
     */
    modifier onlyWhenNonSignerLocked(address _wallet) {
        uint lockFlag = IWallet(_wallet).isLocked();
        require(lockFlag != 2 && lockFlag != 3, "BM: wallet locked by signer related operation");
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
