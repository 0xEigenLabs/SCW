const {waffle, ethers} = require("hardhat");
import { Wallet, utils, BigNumber, providers } from "ethers";
import { expect } from "chai"

import { ModuleRegistry } from "../typechain/ModuleRegistry"
import { ModuleRegistry__factory } from "../typechain/factories/ModuleRegistry__factory"
import { Wallet__factory } from "../typechain/factories/Wallet__factory" 

const helpers = require("./helpers");
const overrides = { gasLimit: 2100000, gasPrice: 10 }

const provider = waffle.provider

let moduleRegistry
let securityModule
let masterWallet
let wallet1
let owner
let user1
let user2
let user3
let sequenceId
const expireTime = Math.floor((new Date().getTime()) / 1000) + 600; // 60 seconds
const salts = [utils.formatBytes32String('1'), utils.formatBytes32String('2')]

describe("Module Registry", () => {
    before(async () => {
        sequenceId = 1

        let factory = await ethers.getContractFactory("ModuleRegistry");
        moduleRegistry = await factory.deploy()
        await moduleRegistry.deployed()
        factory = await ethers.getContractFactory("SecurityModule");
        securityModule = await factory.deploy(moduleRegistry.address)
        await securityModule.deployed()

        //register the module
        let res = await moduleRegistry.registerModule(
            securityModule.address,
            ethers.utils.formatBytes32String("SM")
        );
        await res.wait()

        factory = await ethers.getContractFactory("Wallet")
        masterWallet = await factory.deploy()
        await masterWallet.deployed()

        // FIXME
        let signers = await ethers.getSigners()
        owner = signers[0]
        user1= signers[1]
        user2 = signers[2]
        user3 = signers[3]

        let proxy = await (await ethers.getContractFactory("Proxy")).deploy(masterWallet.address);
        let walletAddress = await proxy.getAddress(salts[0]);
        expect(walletAddress).to.exist;

        const tx = await proxy.create(salts[0]);
        await tx.wait()

        wallet1 = Wallet__factory.connect(walletAddress, owner)

        let modules = [ securityModule.address ]
        let initTx = await wallet1.initialize(
            [owner.address, user1.address, user2.address], modules);
        await initTx.wait()
        console.log("before done")
    })

    beforeEach(async function() {
        await owner.sendTransaction({to: user1.address, value: ethers.utils.parseEther("0.01")})
        await owner.sendTransaction({to: user2.address, value: ethers.utils.parseEther("0.01")})
        await owner.sendTransaction({to: user3.address, value: ethers.utils.parseEther("0.01")})
        // deposit to wallet
        let depositAmount = ethers.utils.parseEther("1")
        await owner.sendTransaction({to: wallet1.address, value: depositAmount})
    })

    it("should trigger recovery", async function() {
        let abi = ["function triggerRecovery(address _wallet, address _recovery, address _removed)"]
        let iface = new ethers.utils.Interface(abi);
        let data = iface.encodeFunctionData( "triggerRecovery",[
            wallet1.address, user3.address, user2.address])

        sequenceId += 1
        let operationHash = await helpers.getSha3ForConfirmationTx(
            "ETHER",
            securityModule.address,
            0,
            data,
            expireTime,
            sequenceId
        );

        let sig = await user2.signMessage(operationHash)
        let res = await wallet1.sendMultiSig(
            securityModule.address, 0, data, expireTime, sequenceId, sig,
            overrides
        );
        let rec = await res.wait()
        await expect(res).to.emit(wallet1, "Transacted")
        await expect(res).to.emit(wallet1, "MultiSigReturns").withArgs("0x")

        let isin = await securityModule.isInRecovery(wallet1.address)
        expect(isin).eq(true)
    });

    it.skip("should upgrade module", async () => {
        let factory = await ethers.getContractFactory("SecurityModule");
        let newModule = await factory.deploy(moduleRegistry.address)
        await newModule.deployed()

        //register the module
        let res = await moduleRegistry.registerModule(
            newModule.address,
            ethers.utils.formatBytes32String("SM2")
        );
        await res.wait()

        let abi = ["function addModule(address _wallet, address _module)"]
        let iface = new ethers.utils.Interface(abi);
        let data = iface.encodeFunctionData( "addModule",[
            wallet1.address, newModule.address])

        sequenceId += 1
        let operationHash = await helpers.getSha3ForConfirmationTx(
            "ETHER",
            newModule.address,
            0,
            data,
            expireTime,
            sequenceId
        );

        let sig = await user2.signMessage(operationHash)
        res = await wallet1.sendMultiSig(
            newModule.address, 0, data, expireTime, sequenceId, sig,
            overrides
        );
        let rec = await res.wait()
        expect(rec.status).eq(1)
        console.log(newModule.address, user2.address, wallet1.address)
        await expect(res).to.emit(wallet1, "AuthorisedModule").withArgs(
            newModule.address, true, newModule.address, wallet1.address)
        await expect(res).to.emit(wallet1, "Transacted")
        await expect(res).to.emit(wallet1, "MultiSigReturns").withArgs("0x")

        let mods = await wallet1.modules();
        expect(mods).eq(2)
    })

    it("should cancel recovery", async () => {
        let abi = ["function cancelRecovery(address _wallet)"]
        let iface = new ethers.utils.Interface(abi);
        let data = iface.encodeFunctionData("cancelRecovery",[wallet1.address])

        sequenceId += 1
        let operationHash = await helpers.getSha3ForConfirmationTx(
            "ETHER",
            securityModule.address,
            0,
            data,
            expireTime,
            sequenceId
        );

        let sig = await user2.signMessage(operationHash)
        let res = await wallet1.sendMultiSig(
            securityModule.address, 0, data, expireTime, sequenceId, sig,
            overrides
        );
        let rec = await res.wait()
        await expect(res).to.emit(wallet1, "Transacted")
        await expect(res).to.emit(wallet1, "MultiSigReturns").withArgs("0x")

        let isin = await securityModule.isInRecovery(wallet1.address)
        expect(isin).eq(false)
    })

    it("should execute recovery", async () => {

        let abi = ["function triggerRecovery(address _wallet, address _recovery, address _removed)"]
        let iface = new ethers.utils.Interface(abi);
        let data = iface.encodeFunctionData( "triggerRecovery",[
            wallet1.address, user3.address, user2.address])

        sequenceId += 1
        let operationHash = await helpers.getSha3ForConfirmationTx(
            "ETHER",
            securityModule.address,
            0,
            data,
            expireTime,
            sequenceId
        );

        let sig = await user1.signMessage(operationHash)
        let res = await wallet1.sendMultiSig(
            securityModule.address, 0, data, expireTime, sequenceId, sig,
            overrides
        );
        let rec = await res.wait()
        await expect(res).to.emit(wallet1, "Transacted")
        await expect(res).to.emit(wallet1, "MultiSigReturns").withArgs("0x")
        let isin = await securityModule.isInRecovery(wallet1.address)
        expect(isin).eq(true)

        abi = ["function executeRecovery(address _wallet)"]
        iface = new ethers.utils.Interface(abi);
        data = iface.encodeFunctionData("executeRecovery",[wallet1.address])

        sequenceId += 1
        operationHash = await helpers.getSha3ForConfirmationTx(
            "ETHER",
            securityModule.address,
            0,
            data,
            expireTime,
            sequenceId
        );

        sig = await user1.signMessage(operationHash)
        res = await wallet1.sendMultiSig(
            securityModule.address, 0, data, expireTime, sequenceId, sig,
            overrides
        );
        rec = await res.wait()
        await expect(res).to.emit(wallet1, "Transacted")
        await expect(res).to.emit(wallet1, "MultiSigReturns").withArgs("0x")

        expect(await wallet1.signers(0)).to.equal(owner.address)
        expect(await wallet1.signers(1)).to.equal(user1.address)
        expect(await wallet1.signers(2)).eq(user3.address)
    })
});
