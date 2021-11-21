// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.6.11;

contract BaseModule {

  /**
   * Modifier that will check if sender is owner
   */
  modifier onlySelf() {
    require(msg.sender == address(this), "only self");
    _;
  }
}
