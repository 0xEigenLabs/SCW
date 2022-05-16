import { waffle, ethers } from "hardhat";
import { Wallet, utils } from "ethers";

import chai = require("chai");
import { solidity } from "ethereum-waffle";
chai.use(solidity);
const { expect } = chai;

import { SecurityModule__factory } from "../typechain/factories/SecurityModule__factory";
import { Wallet__factory } from "../typechain/factories/Wallet__factory"

import helpers = require("./helpers");

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
const SMABI = [
    "function executeRecovery(address)",
    "function cancelRecovery(address)",
    "function triggerRecovery(address, address)",
    "function setSecurityPeriod(address, uint, uint)"
]

const lockPeriod = 5 //s
const recoveryPeriod = 120 //s
let expireTime;
const delay = ms => new Promise(res => setTimeout(res, ms));

describe("Module Registry", () => {
    before(async () => {
        let factory = await ethers.getContractFactory("ModuleRegistry");
        moduleRegistry = await factory.deploy()
        await moduleRegistry.deployed()
        factory = await ethers.getContractFactory("SecurityModule");
        securityModule = await factory.deploy()
        await securityModule.deployed()

        await securityModule.initialize(moduleRegistry.address, lockPeriod, recoveryPeriod)
        console.log("secure module", securityModule.address)

        //register the module
        const res = await moduleRegistry.registerModule(
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
        const signers = [user1, user2, user3]
        signers.sort(function (a, b) { return a.address - b.address })
        user1 = signers[0];
        user2 = signers[1];
        user3 = signers[2];

        console.log("sorted", user1.address, user2.address, user3.address)

        const proxy = await (await ethers.getContractFactory("Proxy")).deploy(masterWallet.address);
        console.log("proxy address", proxy.address)
        const salt = utils.formatBytes32String(utils.sha256(utils.randomBytes(32)).substr(2, 31))
        const walletAddress = await proxy.getAddress(salt);
        expect(walletAddress).to.exist;
        console.log("proxy wallet", walletAddress)

        const tx = await proxy.create(salt);
        await tx.wait()

        wallet1 = Wallet__factory.connect(walletAddress, owner)
        console.log("wallet address", wallet1.address)

        const modules = [securityModule.address]
        const encoder = ethers.utils.defaultAbiCoder
        const data = [encoder.encode(["address[]"], [[user1.address, user2.address]])]
        const initTx = await wallet1.initialize(modules, data);
        await initTx.wait()
    })

    beforeEach(async function () {
        await (await owner.sendTransaction({ to: user1.address, value: ethers.utils.parseEther("0.01") })).wait()
        await (await owner.sendTransaction({ to: user2.address, value: ethers.utils.parseEther("0.01") })).wait()
        await (await owner.sendTransaction({ to: user3.address, value: ethers.utils.parseEther("0.01") })).wait()
        // deposit to wallet
        const depositAmount = ethers.utils.parseEther("0.1")
        await owner.sendTransaction({ to: wallet1.address, value: depositAmount })
        sequenceId = await wallet1.getNextSequenceId()
        const { timestamp: now } = await provider.getBlock('latest')
        expireTime = now + 1800;
    })

    it("change security module's lock period or recovery period", async function () {
        let lp = await securityModule.getLockedSecurityPeriod(wallet1.address)
        let rp = await securityModule.getRecoverySecurityPeriod(wallet1.address)
        expect(lp).eq(5)
        expect(rp).eq(120)

        // change security parameters
        const amount = 0
        let iface = new ethers.utils.Interface(SMABI)
        let data = iface.encodeFunctionData("setSecurityPeriod", [wallet1.address, 4, 119])
        let hash = await helpers.signHash(securityModule.address, amount, data, /*expireTime,*/ sequenceId)
        let signatures = await helpers.getSignatures(ethers.utils.arrayify(hash), [user1, user2])

        // When modifying security parameters, you need to call multi-signature.
        let res = await securityModule.connect(owner).multicall(
            wallet1.address,
            [securityModule.address, amount, data, sequenceId, expireTime],
            signatures
        );
        await res.wait()
        lp = await securityModule.getLockedSecurityPeriod(wallet1.address)
        rp = await securityModule.getRecoverySecurityPeriod(wallet1.address)
        expect(lp).eq(4)
        expect(rp).eq(119)

        // wait for calm-down period
        await delay(lockPeriod * 1000);

        // change back
        iface = new ethers.utils.Interface(SMABI)
        data = iface.encodeFunctionData("setSecurityPeriod", [wallet1.address, 5, 120])
        sequenceId = await wallet1.getNextSequenceId()
        hash = await helpers.signHash(securityModule.address, amount, data, /*expireTime,*/ sequenceId)
        signatures = await helpers.getSignatures(ethers.utils.arrayify(hash), [user1, user2])

        res = await securityModule.connect(owner).multicall(
            wallet1.address,
            [securityModule.address, amount, data, sequenceId, expireTime],
            signatures
        );
        await res.wait()
        //await (await securityModule.connect(owner).setSecurityPeriod(wallet1.address, 5, 120)).wait()
        lp = await securityModule.getLockedSecurityPeriod(wallet1.address)
        rp = await securityModule.getRecoverySecurityPeriod(wallet1.address)
        expect(lp).eq(5)
        expect(rp).eq(120)
    })

    it("should trigger recovery", async function () {
        const sm = SecurityModule__factory.connect(securityModule.address, user1)

        const amount = 0
        let iface = new ethers.utils.Interface(SMABI)
        let data = iface.encodeFunctionData("triggerRecovery", [wallet1.address, user3.address])
        const hash = await helpers.signHash(securityModule.address, amount, data, /*expireTime,*/ sequenceId)
        const signatures = await helpers.getSignatures(ethers.utils.arrayify(hash), [user1, user2])

        let res = await securityModule.connect(owner).multicall(
            wallet1.address,
            [securityModule.address, amount, data, sequenceId, expireTime],
            signatures
        );
        await res.wait()

        res = await sm.isInRecovery(wallet1.address)
        expect(res).eq(true)
        sequenceId = await wallet1.getNextSequenceId()

        iface = new ethers.utils.Interface(SMABI)
        data = iface.encodeFunctionData("cancelRecovery", [wallet1.address])

        const tx = await securityModule.connect(user3).cancelRecovery(wallet1.address)
        await tx.wait()

        res = await sm.isInRecovery(wallet1.address)
        expect(res).eq(false)
    });

    it("should revert recovery", async function () {
        const amount = 0
        const iface = new ethers.utils.Interface(SMABI)
        const data = iface.encodeFunctionData("triggerRecovery", [wallet1.address, user3.address])
        const hash = await helpers.signHash(securityModule.address, amount, data, /*expireTime,*/ sequenceId)
        const signatures = await helpers.getSignatures(ethers.utils.arrayify(hash), [user1, user2])

        await expect(securityModule.connect(user3).multicall(
            wallet1.address,
            [securityModule.address, amount, data, sequenceId, expireTime],
            signatures
        )).to.be.revertedWith("SM: must be signer/wallet");
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

        const amount = 0
        const iface = new ethers.utils.Interface(SMABI)
        const data = iface.encodeFunctionData("triggerRecovery", [wallet1.address, user3.address])
        const hash = await helpers.signHash(securityModule.address, amount, data, /*expireTime,*/ sequenceId)
        const signatures = await helpers.getSignatures(ethers.utils.arrayify(hash), [user1, user2])

        const res = await securityModule.connect(owner).multicall(
            wallet1.address,
            [securityModule.address, amount, data, sequenceId, expireTime],
            signatures
        );
        await res.wait()

        // the new owner executes recovery
        const tx = await securityModule.connect(user3).executeRecovery(wallet1.address)
        await tx.wait()
        res1 = await wallet1.owner();
        expect(res1).eq(user3.address)
    })

    it("should lock", async () => {
        let tx = await securityModule.connect(user1).lock(wallet1.address)
        await tx.wait()

        await expect(securityModule.lock(wallet1.address)).to.be.revertedWith("SM: must be signer/wallet");

        await expect(securityModule.connect(user1).lock(wallet1.address)).to.be.revertedWith("BM: wallet locked globally");

        tx = await securityModule.connect(user1).unlock(wallet1.address)
        await tx.wait()
    })

    it("should change signer", async () => {
        // The owner is user3
        let res1 = await securityModule.isSigner(wallet1.address, user1.address);
        expect(res1).eq(true)
        res1 = await securityModule.isSigner(wallet1.address, user2.address);
        expect(res1).eq(true)
        const tx = await securityModule.connect(user3).replaceSigner(
            wallet1.address, owner.address, user1.address)
        await tx.wait()

        //wait for calm-down period
        await delay(lockPeriod * 1000);

        res1 = await securityModule.isSigner(wallet1.address, user1.address);
        expect(res1).eq(false)
        res1 = await securityModule.isSigner(wallet1.address, user2.address);
        expect(res1).eq(true)
        res1 = await securityModule.isSigner(wallet1.address, owner.address);
        expect(res1).eq(true)
    })

    it("should remove signer", async () => {
        let res1 = await securityModule.isSigner(wallet1.address, user2.address);
        expect(res1).eq(true)
        const tx = await securityModule.connect(user3).removeSigner(
            wallet1.address, user2.address)
        await tx.wait()

        //wait for calm-down period
        await delay(lockPeriod * 1000);

        res1 = await securityModule.isSigner(wallet1.address, user1.address);
        expect(res1).eq(false)
        res1 = await securityModule.isSigner(wallet1.address, user2.address);
        expect(res1).eq(false)
        res1 = await securityModule.isSigner(wallet1.address, owner.address);
        expect(res1).eq(true)
    })

    it("should add signer", async () => {
        // add user1 to signer
        let res1 = await securityModule.isSigner(wallet1.address, user1.address);
        expect(res1).eq(false)
        let tx = await securityModule.connect(user3).addSigner(
            wallet1.address, user2.address)
        await tx.wait()
        res1 = await securityModule.isSigner(wallet1.address, user1.address);
        expect(res1).eq(false)

        await expect(securityModule.connect(user3).addSigner(wallet1.address, user1.address)).to.be.revertedWith("BM: wallet locked by signer related operation");

        // test lock: we can call lock to add global lock even though addSigner had added a signer related lock. 
        tx = await securityModule.connect(user3).lock(wallet1.address)
        //await tx.wait()

        const lockFlag = await securityModule.isLocked(wallet1.address)
        expect(lockFlag).eq(3)

        //wait for calm-down period
        await delay(lockPeriod * 1000);

        tx = await securityModule.connect(user3).addSigner(
            wallet1.address, user1.address)
        await tx.wait()
        res1 = await securityModule.isSigner(wallet1.address, user1.address);
        expect(res1).eq(true)
        res1 = await securityModule.isSigner(wallet1.address, user2.address);
        expect(res1).eq(true)
        res1 = await securityModule.isSigner(wallet1.address, owner.address);
        expect(res1).eq(true)
    })

    it("test lock", async () => {
        const tx = await securityModule.connect(user3).lock(wallet1.address)
        await tx.wait()

        // When the user call the global lock, he or she can't add other locks until the global lock is released.
        await expect(securityModule.connect(user3).removeSigner(wallet1.address, user1.address)).to.be.revertedWith("BM: wallet locked globally");
    })
});
