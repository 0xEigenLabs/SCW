// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.6.11;

import "./IMoudle.sol";

abstract contract BaseModule is IModule {

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
}
