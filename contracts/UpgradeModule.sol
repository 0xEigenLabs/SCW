// SPDX-License-Identifier: Apache-2.0
import "./BaseModule.sol";
import "./IWallet.sol";
import "./IModuleProxy.sol";
import "./Proxy.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";

///
/// @title the special module to upgrade other modules
/// @notice: the steps to deploy this module:
///     1. deploy governance wallet with security module only, which is used for multisig.
///     2. deploy UpgradeModule;
///     3. deploy other module by UpgradeModule's deploy
contract UpgradeModule is BaseModule, Initializable {

    using Clones for address;
    mapping (bytes24 => address) public moduleProxies;

    modifier onlyOwner() {
        require(wallets.length > 0 && wallets[0] == msg.sender, "UM: must be owner");
        _;
    }

    function initialize(
        IModuleRegistry _registry,
        address _governancer
    ) public initializer {
        registry = _registry;
        // check its a IWallet, and the owner is valid
        require(IWallet(_governancer).owner() != address(0), "UM: Invalid governancer");
        require(wallets.length == 0, "UM: Can't setup multiple governancer");
        addWallet(_governancer);
    }

    //function init(address _wallet, bytes memory _data) public override {
    function init(address _wallet, bytes memory data) public override onlyWallet(_wallet) {
        require(false, "Cann't init from wallet");
    }

    function removeModule(address _wallet) public override onlyWallet(_wallet) onlyOwner {
        //removeWallet(_wallet);
        require(false, "Cann't be removed");
    }

    function addModule(address _moduleRegistry, address _wallet, address _module, bytes calldata data) external virtual override onlyWallet(_wallet) onlyWhenUnlocked(_wallet) onlyOwner {
        //require(registry.isRegisteredModule(_module), "TM: module is not registered");
        //IWallet(_wallet).authoriseModule(_moduleRegistry, _module, true, data);
        require(false, "Cann't be added");
    }

    function addModuleProxies(bytes[] memory symbols, address[] memory addresses) onlyOwner {
        require(
            symbols.length == addresses.length && addresses.length < 3,
            "UM: Invalid parameters in add moduleProxies"
        );
        for (uint i = 0; i < symbols.length; i++) {
            require(moduleProxies[symbols[i]] == address(0), "UM: cann't add one grader twice");
            //TODO: check the address is implementation of IModuleProxy
            //require(addresses[i]);
            moduleProxies[symbols[i]] = addresses[i];
        }
    }

    function deploy(bytes24 symbol, address newImplements) onlyOwner {
        require(moduleProxies[symbol] != address(0), "UM: must registered upgrader can upgrade");
        //  1. clone the newImplements to a new contract
        bytes32 salt = ""; //TODO: generate a random
        address newAddress = newImplements.predictDeterministicAddress(salt);
        newImplements.cloneDeterministic(salt);

        //  2. update the moduleProxy
        IModuleProxy(moduleProxies[symbol]).setImplementation(newAddress);
    }

}
