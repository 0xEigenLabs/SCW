const {waffle, ethers} = require("hardhat");
import { Wallet, utils, BigNumber, providers, Transaction } from "ethers";

const chai = require("chai");
const { solidity } = require("ethereum-waffle");
chai.use(solidity);
const { expect } = chai;
const hre = require("hardhat");

import { ModuleRegistry } from "../typechain/ModuleRegistry"
import { ModuleRegistry__factory } from "../typechain/factories/ModuleRegistry__factory"
import { SecurityModule__factory } from "../typechain/factories/SecurityModule__factory"
import { TransactionModule__factory } from "../typechain/factories/TransactionModule__factory"
import { Wallet__factory } from "../typechain/factories/Wallet__factory" 
import {BaseModule__factory} from "../typechain/factories/BaseModule__factory"


const helpers = require("./helpers");

const provider = waffle.provider

let moduleRegistry
let transactionModule
let securityModule
let testToken
let masterWallet
let wallet1
let owner
let user1
let user2
let user3
let sequenceId
const salts = [utils.formatBytes32String('1'), utils.formatBytes32String('2')]
const TMABI = [
    "function executeTransaction(address)",
    "function executeLargeTransaction(address, address, uint, bytes)"
]

let lockPeriod = 5 //s
let recoveryPeriod = 120 //s
let expireTime = Math.floor((new Date().getTime()) / 1000) + 1800; // 60 seconds
const delay = ms => new Promise(res => setTimeout(res, ms));

describe("Transaction test", () => {
    before(async () => {
        let factory = await ethers.getContractFactory("ModuleRegistry");
        moduleRegistry = await factory.deploy()
        await moduleRegistry.deployed()

        factory = await ethers.getContractFactory("SecurityModule");
        securityModule = await factory.deploy()
        await securityModule.deployed()

        factory = await ethers.getContractFactory("TransactionModule");
        transactionModule = await factory.deploy()
        await transactionModule.deployed()

        factory = await ethers.getContractFactory("TestToken");
        testToken = await factory.deploy(100000)
        await testToken.deployed()
        console.log("testToken address", testToken.address)

        await securityModule.initialize(moduleRegistry.address, lockPeriod, recoveryPeriod)
        console.log("secure module", securityModule.address)

        await transactionModule.initialize(moduleRegistry.address)
        console.log("transaction module", transactionModule.address)

        // register the module
        let res = await moduleRegistry.registerModule(
            transactionModule.address,
            ethers.utils.formatBytes32String("TM")
        );
        await res.wait()
        let res1 = await moduleRegistry.registerModule(
            securityModule.address,
            ethers.utils.formatBytes32String("SM")
        );
        await res1.wait()

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
        console.log("proxy address", proxy.address)
        let walletAddress = await proxy.getAddress(salts[0]);
        expect(walletAddress).to.exist;
        console.log("proxy wallet", walletAddress)

        const tx = await proxy.create(salts[0]);
        await tx.wait()

        wallet1 = Wallet__factory.connect(walletAddress, owner)
        console.log("wallet address", wallet1.address)

        /** 
         * There are two ways to add modules to the wallet:
         * 1.Initialize the wallet with the modules.
         * 2.Call the wallet's authoriseModule method.
         */ 
        // 1:Initialize the wallet with the modules.
        // let modules = [ transactionModule.address, securityModule.address]
        // let encoder = ethers.utils.defaultAbiCoder

        // let du = ethers.utils.parseEther("1")
        // let lap = ethers.utils.parseEther("1")
        // let data = [encoder.encode(["uint", "uint"], [du, lap]), encoder.encode(["address[]", "uint", "uint"], [[user1.address, user2.address], lockPeriod, recoveryPeriod])]
        // let initTx = await wallet1.initialize(modules, data);
        // await initTx.wait()

        // 2:Call the wallet's authoriseModule method.
        await (await owner.sendTransaction({to: wallet1.address, value: ethers.utils.parseEther("1.2")})).wait()
        let encoder = ethers.utils.defaultAbiCoder
        // You must initialize the wallet with at least one module.
        await (await wallet1.initialize([securityModule.address], [encoder.encode(["address[]"], [[user1.address, user2.address]])])).wait()

        let du = ethers.utils.parseEther("15")
        let lap = ethers.utils.parseEther("10")
        let tmData = encoder.encode(["uint", "uint"], [du, lap])
        let res2 = await wallet1.connect(owner).authoriseModule(transactionModule.address, true, tmData)
        await res2.wait()
        console.log("Wallet created", wallet1.address) 
    })

    beforeEach(async function() {
        await (await owner.sendTransaction({to: user1.address, value: ethers.utils.parseEther("0.01")})).wait()
        await (await owner.sendTransaction({to: user2.address, value: ethers.utils.parseEther("0.01")})).wait()
        await (await owner.sendTransaction({to: user3.address, value: ethers.utils.parseEther("0.01")})).wait()
        // deposit to wallet
        let depositAmount = ethers.utils.parseEther("0.1")
        await owner.sendTransaction({to: wallet1.address, value: depositAmount})
        sequenceId = await wallet1.getNextSequenceId()
        expireTime = Math.floor((new Date().getTime()) / 1000) + 1800;
    })

    it.only("change transaction module's daily upbound or large amount payment", async function() {
        let du = await transactionModule.getDailyUpbound(wallet1.address)
        let lap = await transactionModule.getLargeAmountPayment(wallet1.address)
        expect(du).eq(ethers.utils.parseEther("15"))
        expect(lap).eq(ethers.utils.parseEther("10"))

        await (await transactionModule.connect(owner).setTMParametar(wallet1.address, ethers.utils.parseEther("14"), ethers.utils.parseEther("9"))).wait()
        du = await transactionModule.getDailyUpbound(wallet1.address)
        lap = await transactionModule.getLargeAmountPayment(wallet1.address)
        expect(du).eq(ethers.utils.parseEther("14"))
        expect(lap).eq(ethers.utils.parseEther("9"))

        // wait for calm-down period
        await delay(lockPeriod * 1000);
        
        await (await transactionModule.connect(owner).setTMParametar(wallet1.address, ethers.utils.parseEther("15"), ethers.utils.parseEther("10"))).wait()
        du = await transactionModule.getDailyUpbound(wallet1.address)
        lap = await transactionModule.getLargeAmountPayment(wallet1.address)
        expect(du).eq(ethers.utils.parseEther("15"))
        expect(lap).eq(ethers.utils.parseEther("10"))
    })

    it("execute transaction test", async function() {
        console.log(owner.address)
        await (await owner.sendTransaction({to: wallet1.address, value: ethers.utils.parseEther("0.01")})).wait()
        let user3StartEther = await provider.getBalance(user3.address);
        
        console.log(user3StartEther.toString())
        let amount = ethers.utils.parseEther("0.01")
        sequenceId = await wallet1.getNextSequenceId()
        
        let res = await transactionModule.connect(owner).executeTransaction(
            wallet1.address,
            [user3.address, amount, "0x", sequenceId, expireTime]
        );
        await res.wait()

        // wait for calm-down period
        await delay(lockPeriod * 1000);
        
        let user3EndEther = (await provider.getBalance(user3.address));
        expect(user3EndEther).eq(user3StartEther.add(amount))
    });

    it("execute ERC20 token transaction test", async function() {
        console.log(owner.address)

        let erc20Artifact = await hre.artifacts.readArtifact("TestToken");
        const TestTokenABI = erc20Artifact.abi

        let ownerContract = new ethers.Contract(testToken.address, TestTokenABI, owner)
        let ownerBalance = (await ownerContract.balanceOf(owner.address)).toString()
        console.log("owner balance", ownerBalance)

        await (await ownerContract.transfer(wallet1.address, 10)).wait()

        let user3Contract = new ethers.Contract(testToken.address, TestTokenABI, user3)
        let user3StartBalance = (await user3Contract.balanceOf(user3.address))
        console.log("user3StartBalance ", user3StartBalance.toString())
        
        let amount = 1
        sequenceId = await wallet1.getNextSequenceId()
        let iface = new ethers.utils.Interface(TestTokenABI)
        let txData = iface.encodeFunctionData("transfer", [user3.address, amount])
        
        let res = await transactionModule.connect(owner).executeTransaction(
            wallet1.address,
            [testToken.address, 0, txData, sequenceId, expireTime]
        );
        await res.wait()

        // wait for calm-down period
        await delay(lockPeriod * 1000);
        
        let user3EndBalance = (await user3Contract.balanceOf(user3.address))
        console.log("user3EndBalance ", user3EndBalance.toString())
        expect(user3EndBalance).eq(user3StartBalance.add(amount))
    });

    it("execute large transaction test", async function() {
        await (await owner.sendTransaction({to: wallet1.address, value: ethers.utils.parseEther("16")})).wait()

        let user3StartEther = await provider.getBalance(user3.address);
        console.log(user3StartEther.toString())

        let amount = ethers.utils.parseEther("11")
        let amountMulti = 0
        sequenceId = await wallet1.getNextSequenceId()
        let iface = new ethers.utils.Interface(TMABI)
        let largeTxData = iface.encodeFunctionData("executeLargeTransaction", [wallet1.address, user3.address, amount, "0x"])
        let hash = await helpers.signHash(transactionModule.address, amountMulti, largeTxData, /*expireTime,*/ sequenceId)
        let signatures = await helpers.getSignatures(ethers.utils.arrayify(hash), [user1, user2])

        let res = await securityModule.connect(owner).multicall(
            wallet1.address,
            [transactionModule.address, amountMulti, largeTxData, sequenceId, expireTime],
            signatures
        );
        await res.wait()

        let user3EndEther = (await provider.getBalance(user3.address));
        console.log(user3EndEther.toString())
        expect(user3EndEther).eq(user3StartEther.add(amount))
    });

    it("daily limit check test", async function() {
        // In the last test case, wallet1 transferred 11 eth to user3, and in this test case wallet1 transferred 5 eth to user3. This transfer triggered the daily limit.
        let amount = ethers.utils.parseEther("5")
        sequenceId = await wallet1.getNextSequenceId()
        
        await expect(transactionModule.connect(owner).executeTransaction(
            wallet1.address,
            [user3.address, amount, "0x", sequenceId, expireTime]
        )).to.be.revertedWith("TM:Daily limit reached");
    })
});
