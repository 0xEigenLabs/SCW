// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.6.11;

interface IModule {
    function addModule(address _wallet, address _module) external;
}
