// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.6.11;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./Wallet.sol";

contract WalletFactory is Ownable {
    address public master;
    event NewWallet(address indexed addr);
    using Clones for address;

    constructor(address _master) public {
        master = _master;
    }

    function getWalletAddress(bytes32 salt) external view returns (address) {
        require (master != address(0), "master must be set");
        return master.predictDeterministicAddress(salt);
    }

    function createWallet(bytes32 salt) external payable {
        master.cloneDeterministic(salt);
    }
}
