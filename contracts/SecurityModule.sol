// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.6.11;

import "./BaseModule.sol";

contract SecurityModule is BaseModule {

    uint constant RECOVERY_SECURITY_PERIOD = 120;

    struct Recovery {
        uint96 activeAt; // timestamp for activation of escape mode, 0 otherwise
        address caller;
    }

    struct Lock {
        // the lock's release timestamp
        uint64 releaseAt;
        // the signature of the method that set the last lock
        bytes4 locker;
    }

    //social recovery
    Recovery public recovery;

    // social recover
    /**
     * Declare a recovery, executed by contract itself, called by sendMultiSig.
     * @param _recovery: lost signer
     */
    function triggerRecovery(address _recovery) public onlySelf {
        //require(isSigner(_recovery), "invalid _recovery");

        if (recovery.activeAt != 0 && recovery.activeAt > block.timestamp) {
            //require(isSigner(recovery.caller), "invalid recovery.caller");
            require(recovery.caller != _recovery, "Should not repeatly recovery");
        }

        recovery = Recovery(uint96(block.timestamp + RECOVERY_SECURITY_PERIOD), _recovery);
    }

    function cancelRecovery() public onlySelf {
        //require(recovery.activeAt != 0 && recovery.caller != address(0), "not recovering");
        require(recovery.activeAt <= block.timestamp, "not recovering");
        delete recovery;
    }

    function recoverSigner(address[] memory signers) public onlySelf returns (uint){
        require(recovery.activeAt <= block.timestamp, "no active recovery");
        for (uint i = 0; i < signers.length; i++) {
            if (signers[i] == recovery.caller) {
                return i;
            }
        }
        delete recovery;
    }
}
