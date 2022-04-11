// SPDX-License-Identifier: Apache-2.0
import "./BaseModule.sol";
import "./IWallet.sol";
import "./IUpgrader.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";

///
/// @title the special module to upgrade other modules
/// @notice: the steps to deploy this module:
///     1. deploy governance wallet with no module.
///     2. deploy UpgradeModule;
///     3. deploy other module by UpgradeModule's deploy
contract UpgradeModule is BaseModule, Initializable {

    mapping (bytes24 => address) public upgraders;

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

    function addUpgraders(bytes[] memory symbols, address[] memory addresses) onlyOwner {
        require(
            symbols.length == addresses.length && addresses.length < 3,
            "UM: Invalid parameters in add upgraders"
        );
        for (uint i = 0; i < symbols.length; i++) {
            require(upgraders[symbols[i]] == address(0), "UM: cann't add one grader twice");
            //TODO: check the address is implementation of IUpgrade
            //require(addresses[i]);
            upgraders[symbols[i]] = addresses[i];
        }
    }

    function upgrade(bytes24 symbol, address newImplements) onlyOwner {
        require(upgraders[symbol] != address(0), "UM: must registered upgrader can upgrade");
        IUpgrade(upgraders[symbol]).setImplementation(newImplements);
    }

    // TODO
    function deploy() {

    }
}
