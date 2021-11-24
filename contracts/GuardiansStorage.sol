// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.6.11;

contract GuardiansStorage {

     struct GuardianStorageConfig {
        // the list of guardians
        address[] guardians;
        // the info about guardians
        mapping (address => GuardianInfo) info;
        // the lock's release timestamp
        uint256 lock;
        // the module that set the last lock
        address locker;
    }

    struct GuardianInfo {
        bool exists;
        uint128 index;
    }

    mapping (address => GuardianStorageConfig) internal configs;

    /**
     * @notice Lets an authorised module add a guardian to a wallet.
     * @param _wallet The target wallet.
     * @param _guardian The guardian to add.
     */
    function addGuardian(address _wallet, address _guardian) external {
        GuardianStorageConfig storage config = configs[_wallet];
        config.info[_guardian].exists = true;
        config.guardians.push(_guardian);
        config.info[_guardian].index = uint128(config.guardians.length - 1);
    }

    /**
     * @notice Lets an authorised module revoke a guardian from a wallet.
     * @param _wallet The target wallet.
     * @param _guardian The guardian to revoke.
     */
    function revokeGuardian(address _wallet, address _guardian) external {
        GuardianStorageConfig storage config = configs[_wallet];
        address lastGuardian = config.guardians[config.guardians.length - 1];
        if (_guardian != lastGuardian) {
            uint128 targetIndex = config.info[_guardian].index;
            config.guardians[targetIndex] = lastGuardian;
            config.info[lastGuardian].index = targetIndex;
        }
        //config.guardians.length--;
        delete config.info[_guardian];
    }

    /**
     * @notice Returns the number of guardians for a wallet.
     * @param _wallet The target wallet.
     * @return the number of guardians.
     */
    function guardianCount(address _wallet) external view returns (uint256) {
        return configs[_wallet].guardians.length;
    }

    /**
     * @notice Gets the list of guaridans for a wallet.
     * @param _wallet The target wallet.
     * @return the list of guardians.
     */
    function getGuardians(address _wallet) external view returns (address[] memory) {
        GuardianStorageConfig storage config = configs[_wallet];
        address[] memory guardians = new address[](config.guardians.length);
        for (uint256 i = 0; i < config.guardians.length; i++) {
            guardians[i] = config.guardians[i];
        }
        return guardians;
    }

    /**
     * @notice Checks if an account is a guardian for a wallet.
     * @param _wallet The target wallet.
     * @param _guardian The account.
     * @return true if the account is a guardian for a wallet.
     */
    function isGuardian(address _wallet, address _guardian) external view returns (bool) {
        return configs[_wallet].info[_guardian].exists;
    }

    /**
     * @notice Lets an authorised module set the lock for a wallet.
     * @param _wallet The target wallet.
     * @param _releaseAfter The epoch time at which the lock should automatically release.
     */
    function setLock(address _wallet, uint256 _releaseAfter) external {
        configs[_wallet].lock = _releaseAfter;
        if (_releaseAfter != 0 && msg.sender != configs[_wallet].locker) {
            configs[_wallet].locker = msg.sender;
        }
    }

    /**
     * @notice Checks if the lock is set for a wallet.
     * @param _wallet The target wallet.
     * @return true if the lock is set for the wallet.
     */
    function isLocked(address _wallet) external view returns (bool) {
        return configs[_wallet].lock > block.timestamp;
    }

    /**
     * @notice Gets the time at which the lock of a wallet will release.
     * @param _wallet The target wallet.
     * @return the time at which the lock of a wallet will release, or zero if there is no lock set.
     */
    function getLock(address _wallet) external view returns (uint256) {
        return configs[_wallet].lock;
    }

    /**
     * @notice Gets the address of the last module that modified the lock for a wallet.
     * @param _wallet The target wallet.
     * @return the address of the last module that modified the lock for a wallet.
     */
    function getLocker(address _wallet) external view returns (address) {
        return configs[_wallet].locker;
    }
}
