// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;
//pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "./BaseModule.sol";

contract TransactionModule is BaseModule, Initializable {

    struct PaymentLimitation {
        uint daily_upbound; // need multi signature if total amount over this
        uint large_amount_payment; // need multi signature if single amount over this
        bool exist;
    }

    mapping (address => PaymentLimitation) public paymentInfos;

    constructor() public {}

    function initalize(IModuleRegistry _registry) public initializer {
        registry = _registry;
    }

    function init(address _wallet, bytes memory data) public override onlyWallet(_wallet) {
        require(!isRegisteredWallet(_wallet), "TM: should not add same module to wallet twice");
        require(!paymentInfos[_wallet].exist, "TM: wallet exists in paymentInfos");
        addWallet(_wallet);
        (uint _daily_upbound, uint _lap) = abi.decode(data, (uint, uint));

        PaymentLimitation storage pl = paymentInfos[_wallet];
        pl.daily_upbound = _daily_upbound;
        pl.large_amount_payment = _lap;
        pl.exist = true;
    }

    /**
     * add new module to wallet
     * @param _wallet attach module to new module
     * @param _module attach module
     */
    function addModule(address _wallet, address _module, bytes calldata data) external virtual override onlyWallet(_wallet) onlyWhenUnlocked(_wallet) {
        require(registry.isRegisteredModule(_module), "SM: module is not registered");
        IWallet(_wallet).authoriseModule(_module, true, data);
    }

    function executeTransaction(address _wallet, CallArgs memory _args) public onlyOwner(_wallet) onlyWhenUnlocked(_wallet) returns (uint){
        //TODO payment limitation
        execute(_wallet, _args);
    }

}
