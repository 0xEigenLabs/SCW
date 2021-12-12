const {waffle, ethers} = require("hardhat");
import { Wallet, utils, BigNumber, providers } from "ethers";

const chai = require("chai");
const { solidity } = require("ethereum-waffle");
chai.use(solidity);
const { expect } = chai;

import { ModuleRegistry } from "../typechain/ModuleRegistry"
import { ModuleRegistry__factory } from "../typechain/factories/ModuleRegistry__factory"
import { SecurityModule__factory } from "../typechain/factories/SecurityModule__factory";
import { Wallet__factory } from "../typechain/factories/Wallet__factory" 

const helpers = require("./helpers");
const overrides = { gasLimit: 8000000, gasPrice: 10000 }

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
const SMABI = [
    "function executeRecovery(address)",
    "function cancelRecovery(address)",
    "function triggerRecovery(address, address)"
]

describe("Module Registry", () => {
    before(async () => {
        let factory = await ethers.getContractFactory("ModuleRegistry");
        moduleRegistry = await factory.deploy()
        await moduleRegistry.deployed()
        factory = await ethers.getContractFactory("SecurityModule");
        securityModule = await factory.deploy(moduleRegistry.address)
        await securityModule.deployed()
        console.log("secure module", securityModule.address)

        //register the module
        let res = await moduleRegistry.registerModule(
            securityModule.address,
            ethers.utils.formatBytes32String("SM")
        );
        await res.wait()

        factory = await ethers.getContractFactory("Wallet")
        masterWallet = await factory.deploy()
        await masterWallet.deployed()
        console.log("master wallet", masterWallet.address)

        // FIXME
        owner = await ethers.getSigner()
        user1 = Wallet.createRandom().connect(provider)
        user2 = Wallet.createRandom().connect(provider)
        user3 = Wallet.createRandom().connect(provider)

        console.log("unsorted", user1.address, user2.address, user3.address)
        let signers = [user1, user2, user3]
        signers.sort(function(a, b) { return a.address - b.address })
        user1 = signers[0];
        user2 = signers[1];
        user3 = signers[2];

        console.log("sorted", user1.address, user2.address, user3.address)

        let proxy = await (await ethers.getContractFactory("Proxy")).deploy(masterWallet.address);
        let walletAddress = await proxy.getAddress(salts[0]);
        expect(walletAddress).to.exist;
        console.log("proxy wallet", walletAddress)

        const tx = await proxy.create(salts[0]);
        await tx.wait()

        wallet1 = Wallet__factory.connect(walletAddress, owner)
        console.log("wallet address", wallet1.address)

        let modules = [ securityModule.address ]
        let encoder = ethers.utils.defaultAbiCoder
        let data = [encoder.encode(["address[]"], [[user1.address, user2.address]])]
        let initTx = await wallet1.initialize(modules, data);
        await initTx.wait()
    })

    beforeEach(async function() {
        await (await owner.sendTransaction({to: user1.address, value: ethers.utils.parseEther("1")})).wait()
        await (await owner.sendTransaction({to: user2.address, value: ethers.utils.parseEther("1")})).wait()
        await (await owner.sendTransaction({to: user3.address, value: ethers.utils.parseEther("1")})).wait()
        // deposit to wallet
        let depositAmount = ethers.utils.parseEther("0.1")
        await owner.sendTransaction({to: wallet1.address, value: depositAmount})
        sequenceId = await wallet1.getNextSequenceId()
        console.log("before done")
    })

    it("should trigger recovery", async function() {
        let sm = SecurityModule__factory.connect(securityModule.address, user1)

        let amount = 0
        let iface = new ethers.utils.Interface(SMABI)
        let replaceOwnerData = iface.encodeFunctionData("triggerRecovery", [wallet1.address, user3.address])
        let hash = await helpers.signHash(securityModule.address, amount, replaceOwnerData, /*expireTime,*/ sequenceId)
        let signatures = await helpers.getSignatures(ethers.utils.arrayify(hash), [user1, user2])

        let res = await securityModule.connect(owner).multicall(
            wallet1.address,
            [securityModule.address, amount, replaceOwnerData, sequenceId, expireTime],
            signatures,
            overrides
        );
        await res.wait()

        res = await sm.isInRecovery(wallet1.address)
        expect(res).eq(true)
        sequenceId = await wallet1.getNextSequenceId()

        iface = new ethers.utils.Interface(SMABI)
        replaceOwnerData = iface.encodeFunctionData("cancelRecovery", [wallet1.address])
        hash = await helpers.signHash(securityModule.address, amount, replaceOwnerData, /*expireTime,*/ sequenceId)
        signatures = await helpers.getSignatures(ethers.utils.arrayify(hash), [user1, user2])

        res = await securityModule.connect(owner).multicall(
            wallet1.address,
            [securityModule.address, amount, replaceOwnerData, sequenceId, expireTime],
            signatures,
            overrides
        );
        await res.wait()

        res = await sm.isInRecovery(wallet1.address)
        expect(res).eq(false)
    });

    it("should revert recovery", async function() {
        let sm = SecurityModule__factory.connect(securityModule.address, user3)
        try {
            let amount = 0
            let iface = new ethers.utils.Interface(SMABI)
            let replaceOwnerData = iface.encodeFunctionData("triggerRecovery", [wallet1.address, user3.address])
            let hash = await helpers.signHash(securityModule.address, amount, replaceOwnerData, /*expireTime,*/ sequenceId)
            let signatures = await helpers.getSignatures(ethers.utils.arrayify(hash), [user1, user2])

            let res = await securityModule.connect(user3).multicall(
                wallet1.address,
                [securityModule.address, amount, replaceOwnerData, sequenceId, expireTime],
                signatures,
                overrides
            );
            throw new Error("unreachable")
        } catch (e) {}
    })

    it("should execute recovery", async () => {
        let res1 = await securityModule.isSigner(wallet1.address, user1.address);
        expect(res1).eq(true)
        res1 = await securityModule.isSigner(wallet1.address, user2.address);
        expect(res1).eq(true)

        res1 = await securityModule.isSigner(wallet1.address, user3.address);
        expect(res1).eq(false)

        res1 = await wallet1.owner();
        expect(res1).eq(owner.address)

        let amount = 0
        let iface = new ethers.utils.Interface(SMABI)
        let replaceOwnerData = iface.encodeFunctionData("triggerRecovery", [wallet1.address, user3.address])
        let hash = await helpers.signHash(securityModule.address, amount, replaceOwnerData, /*expireTime,*/ sequenceId)
        let signatures = await helpers.getSignatures(ethers.utils.arrayify(hash), [user1, user2])

        let res = await securityModule.connect(owner).multicall(
            wallet1.address,
            [securityModule.address, amount, replaceOwnerData, sequenceId, expireTime],
            signatures,
            overrides
        );
        await res.wait()


        sequenceId = await wallet1.getNextSequenceId()
        iface = new ethers.utils.Interface(SMABI)
        replaceOwnerData = iface.encodeFunctionData("executeRecovery", [wallet1.address])
        hash = await helpers.signHash(securityModule.address, amount, replaceOwnerData, /*expireTime,*/ sequenceId)
        signatures = await helpers.getSignatures(ethers.utils.arrayify(hash), [user1, user2])

        res = await securityModule.connect(user1).multicall(
            wallet1.address,
            [securityModule.address, amount, replaceOwnerData, sequenceId, expireTime],
            signatures,
            overrides
        );
        await res.wait()
        //await expect(res).to.emit(wallet1, "MultiCalled")
        res1 = await wallet1.owner();
        expect(res1).eq(user3.address)
    })

    it("should lock", async() => {
        let tx
        tx = await securityModule.connect(user1).lock(wallet1.address, overrides)
        await tx.wait()

        try {
            tx = await securityModule.lock(wallet1.address, overrides)
            throw new Error("unreachable")
        } catch (e) {}

        try{
            await securityModule.connect(user1).lock(wallet1.address, overrides)
            throw new Error("unreachable")
        } catch(e) {}

        tx = await securityModule.connect(user1).unlock(wallet1.address, overrides)
        await tx.wait()
    })

    it("should change signer", async() => {
        // owner has been changed to user3
        let res1 = await securityModule.isSigner(wallet1.address, user1.address);
        expect(res1).eq(true)
        res1 = await securityModule.isSigner(wallet1.address, user2.address);
        expect(res1).eq(true)
        let tx = await securityModule.connect(user3).replaceSigner(
            wallet1.address, owner.address, user1.address, overrides)
        await tx.wait()
        res1 = await securityModule.isSigner(wallet1.address, user1.address);
        expect(res1).eq(false)
        res1 = await securityModule.isSigner(wallet1.address, user2.address);
        expect(res1).eq(true)
        res1 = await securityModule.isSigner(wallet1.address, owner.address);
        expect(res1).eq(true)
    })
});
