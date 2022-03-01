// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;
//pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "./BaseModule.sol";

contract TransactionModule is BaseModule, Initializable {
    // events
    event TMInited(address _walslet, bytes data);
    event TMParameterChanged(address _wallet, uint _dailyUpbound, uint _largeAmountPayment);
    event ExecuteTransaction(address _wallet, CallArgs _args);
    event ExecuteLargeTransaction(address _wallet, address _to, uint _value, bytes _data);

    struct PaymentLimitation {
        uint dailyUpbound; // need multi signature if total amount over this
        uint largeAmountPayment; // need multi signature if single amount over this
        bool exist;
        uint dailySpendLeft;
        uint lastSpendWindow;
    }

    mapping (address => PaymentLimitation) public paymentInfos;

    constructor() {}

    function initialize(IModuleRegistry _registry) public initializer {
        registry = _registry;
    }

    function init(address _wallet, bytes memory data) public override onlyWallet(_wallet) {
        require(!isRegisteredWallet(_wallet), "TM: should not add same module to wallet twice");
        require(!paymentInfos[_wallet].exist, "TM: wallet exists in paymentInfos");
        addWallet(_wallet);
        (uint _dailyUpbound, uint _largeAmountPayment) = abi.decode(data, (uint, uint));

        PaymentLimitation storage pl = paymentInfos[_wallet];
        pl.dailyUpbound = _dailyUpbound;
        pl.largeAmountPayment = _largeAmountPayment;
        pl.exist = true;
        emit TMInited(_wallet, data);
    }

    function removeModule(address _wallet) public override onlyWallet(_wallet) {
        require(paymentInfos[_wallet].exist, "TM: wallet doesn't register PaymentLimitation");

        removeWallet(_wallet);
        delete paymentInfos[_wallet];
    }

    function setTMParameter(address _wallet, uint _dailyUpbound, uint _largeAmountPayment) external onlyWallet(_wallet) onlyWhenUnlocked(_wallet) {
        require(paymentInfos[_wallet].exist, "TM: wallet doesn't register PaymentLimitation");
        PaymentLimitation storage pl = paymentInfos[_wallet];
        require(pl.dailyUpbound != _dailyUpbound || pl.largeAmountPayment != _largeAmountPayment, "TM:must change at least one parameter");
        if (pl.dailyUpbound != _dailyUpbound) {
            pl.dailyUpbound = _dailyUpbound;
        }
        if (pl.largeAmountPayment != _largeAmountPayment) {
            pl.largeAmountPayment = _largeAmountPayment;
        }
        emit TMParameterChanged(_wallet, _dailyUpbound, _largeAmountPayment);
    }

    function getDailyUpbound(address _wallet) public view returns (uint) {
        require(paymentInfos[_wallet].exist, "TM: wallet doesn't register PaymentLimitation");
        PaymentLimitation memory pl = paymentInfos[_wallet];
        return pl.dailyUpbound;
    }

    function getLargeAmountPayment(address _wallet) public view returns (uint) {
        require(paymentInfos[_wallet].exist, "TM: wallet doesn't register PaymentLimitation");
        PaymentLimitation memory pl = paymentInfos[_wallet];
        return pl.largeAmountPayment;
    }

    /**
     * add new module to wallet
     * @param _wallet attach module to new module
     * @param _module attach module
     */
    function addModule(address _moduleRegistry, address _wallet, address _module, bytes calldata data) external virtual override onlyWallet(_wallet) onlyWhenUnlocked(_wallet) {
        require(registry.isRegisteredModule(_module), "TM: module is not registered");
        IWallet(_wallet).authoriseModule(_moduleRegistry, _module, true, data);
    }

    function executeTransaction(address _wallet, CallArgs memory _args) external onlyOwner(_wallet) onlyWhenNonGloballyLocked(_wallet) {
        require(paymentInfos[_wallet].exist, "TM: wallet doesn't register PaymentLimitation");
        PaymentLimitation storage pl = paymentInfos[_wallet];
        require(_args.value <= pl.largeAmountPayment, "TM: Single payment excceed largeAmountPayment");
        if (block.timestamp >= pl.lastSpendWindow) {
            pl.dailySpendLeft = pl.dailyUpbound - _args.value;
            pl.lastSpendWindow = block.timestamp + 24 hours;
        } else {
            require(pl.dailySpendLeft >= _args.value, "TM:Daily limit reached");
            pl.dailySpendLeft -= _args.value;
        }
        execute(_wallet, _args);
        emit ExecuteTransaction(_wallet, _args);
    }

    function executeLargeTransaction(address _wallet, address _to, uint _value, bytes memory _data) public onlyWallet(_wallet) onlyWhenUnlocked(_wallet) returns (bytes memory _result){
        require(_to != address(this), "TM: cann't call itself");
        require(paymentInfos[_wallet].exist, "TM: wallet doesn't register PaymentLimitation");
        PaymentLimitation storage pl = paymentInfos[_wallet];
        require(_value > pl.largeAmountPayment, "TM: Single payment lower than largeAmountPayment");
        if (block.timestamp >= pl.lastSpendWindow) {
            pl.dailySpendLeft = pl.dailyUpbound - _value;
            pl.lastSpendWindow = block.timestamp + 24 hours;
        } else {
            require(pl.dailySpendLeft >= _value, "TM:Daily limit reached");
            pl.dailySpendLeft -= _value;
        }
        emit ExecuteLargeTransaction(_wallet, _to, _value, _data);
        bytes memory res = IWallet(_wallet).raw_invoke(_to, _value, _data);
        _setLock(_wallet, block.timestamp + lockedSecurityPeriod, this.executeLargeTransaction.selector);
        return res;
    }
}
