// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.6.11;

interface IWalletSimple {
    struct Recovery {
        uint96 activeAt; // timestamp for activation of escape mode, 0 otherwise
        address caller;
    }
}
