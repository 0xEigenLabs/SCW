// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Proxy is Ownable {
    address public master;
    using Clones for address;

    constructor(address _master) public {
        master = _master;
    }

    function getAddress(bytes32 salt) external view returns (address) {
        require (master != address(0), "master must be set");
        return master.predictDeterministicAddress(salt);
    }

    function create(bytes32 salt) external payable {
        master.cloneDeterministic(salt);
    }
}
