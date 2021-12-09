// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.6.11;

interface IModule {
    function init(address _wallet, bytes memory _data) external;
    function addModule(address _wallet, address _module, bytes calldata _data) external;
}
