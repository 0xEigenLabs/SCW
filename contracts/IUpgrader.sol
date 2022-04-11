// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

interface IUpgrader {
    function setImplementation(address _imp) external;
}
