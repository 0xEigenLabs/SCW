// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

interface IModule {
    function init(address _wallet, bytes memory _data) external;
    function removeModule(address _wallet) external;
    function addModule(address _wallet, address _module, bytes calldata _data) external;
}
