// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.6.11;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./IModuleRegistry.sol";

contract ModuleRegistry is Ownable, IModuleRegistry{

    mapping (address => Meta) internal modules;
    struct Meta {
        bool exists;
        bytes32 name;
    }

    /**
     * @notice Registers a module.
     * @param _module The module.
     * @param _name The unique name of the module.
     */
    function registerModule(address _module, bytes32 _name) external override onlyOwner {
        require(!modules[_module].exists, "MR: module already exists");
        modules[_module] = Meta({exists: true, name: _name});
        //emit ModuleRegistered(_module, _name);
    }

    /**
     * @notice Deregisters a module.
     * @param _module The module.
     */
    function deregisterModule(address _module) external override onlyOwner {
        require(modules[_module].exists, "MR: module does not exist");
        delete modules[_module];
        //emit ModuleDeRegistered(_module);
    }

    /**
     * @notice Gets the name of a module from its address.
     * @param _module The module address.
     * @return the name.
     */
    function moduleName(address _module) external view override returns (bytes32) {
        return modules[_module].name;
    }

    /**
     * @notice Checks if a module is registered.
     * @param _module The module address.
     * @return true if the module is registered.
     */
    function isRegisteredModule(address _module) external view override returns (bool) {
        return modules[_module].exists;
    }
}
