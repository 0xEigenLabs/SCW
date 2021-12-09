// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.6.11;

interface IWallet {

    /**
     * @notice Return the owner
     */
    function owner() external view returns (address);

    /**
     * @notice Returns the number of authorised modules.
     * @return The number of authorised modules.
     */
    function modules() external view returns (uint);

    /**
     * @notice replace the wallet owner.
     * @param _newOwner The new signer.
     */
    function replaceOwner(address _newOwner) external;

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
    function authoriseModule(address _module, bool _value, bytes memory data) external;


    function createForwarder() external returns (address);

    function invoke(
        address toAddress,
        uint value,
        bytes calldata data,
        uint expireTime,
        uint sequenceId
    ) external returns (bytes memory);
}
