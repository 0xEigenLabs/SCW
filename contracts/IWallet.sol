// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.6.11;

interface IWallet {

    /**
     * @notice Return the wallet signers
     */
    function getSigners() external view returns (address[] memory);

    /**
     * @notice Returns the number of authorised modules.
     * @return The number of authorised modules.
     */
    function modules() external view returns (uint);

    /**
     * @notice replace the old signer by new signer for the wallet.
     * @param _oldSigner the old signer in the signer list
     * @param _newSigner The new signer.
     */
    function replaceSigner(address _oldSigner, address _newSigner) external;

    /**
     * @notice Checks if a module is authorised on the wallet.
     * @param _module The module address to check.
     * @return `true` if the module is authorised, otherwise `false`.
     */
    function authorised(address _module) external view returns (bool);

    /**
     * @notice Enables/Disables a module.
     * @param _module The target module.
     * @param _value Set to `true` to authorise the module.
     */
    function authoriseModule(address _module, bool _value) external;


    function createForwarder() external returns (address);

    function sendMultiSig(
        address toAddress,
        uint value,
        bytes memory data,
        uint expireTime,
        uint sequenceId,
        bytes memory signature
    ) external;
}
