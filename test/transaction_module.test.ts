const {waffle, ethers} = require("hardhat");
import { Wallet, utils, BigNumber, providers, Transaction } from "ethers";

const chai = require("chai");
const { solidity } = require("ethereum-waffle");
chai.use(solidity);
const { expect } = chai;

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
let masterWallet
let wallet1
let owner
let user1
let user2
let user3
let sequenceId
const salts = [utils.formatBytes32String('1'), utils.formatBytes32String('2')]
const TMABI = [
    "function executeTransaction(address)", // to be confirmed
    "function executeLargeTransaction(address, address, uint, bytes)" // to be confirmed
]

let lock_period = 10 //s
let recovery_period = 120 //s
let expireTime = Math.floor((new Date().getTime()) / 1000) + 600; // 60 seconds

describe.only("Transaction test", () => {
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

        await securityModule.initialize(moduleRegistry.address, lock_period, recovery_period)
        console.log("secure module", securityModule.address)

        await transactionModule.initialize(moduleRegistry.address)
        console.log("transaction module", transactionModule.address)

        //register the module
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

        let modules = [ transactionModule.address, securityModule.address]
        let encoder = ethers.utils.defaultAbiCoder


        let du = ethers.utils.parseEther("1")
        let lap = ethers.utils.parseEther("1")
        let data = [encoder.encode(["uint", "uint"], [du, lap]), encoder.encode(["address[]"], [[user1.address, user2.address]])]
        let initTx = await wallet1.initialize(modules, data);
        await initTx.wait()
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
        expireTime = Math.floor((new Date().getTime()) / 1000) + 600; // 60 seconds
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
        
        let user3EndEther = (await provider.getBalance(user3.address));
        expect(user3EndEther).eq(user3StartEther.add(amount))
    });

    it.only("execute large transaction test", async function() {
        console.log(owner.address)

        await (await owner.sendTransaction({to: wallet1.address, value: ethers.utils.parseEther("2")})).wait()

        let user3StartEther = await provider.getBalance(user3.address);
        console.log("111")
        console.log("222")

        console.log("333")

        let amount = ethers.utils.parseEther("2")
        sequenceId = await wallet1.getNextSequenceId()
        let iface = new ethers.utils.Interface(TMABI)
        let largeTxData = iface.encodeFunctionData("executeLargeTransaction", [wallet1.address, user3.address, amount, "0x"])
        let hash = await helpers.signHash(transactionModule.address, amount, largeTxData, /*expireTime,*/ sequenceId)
        let signatures = await helpers.getSignatures(ethers.utils.arrayify(hash), [user1, user2])

        console.log("444")

        let res = await securityModule.connect(owner).multicall(
            wallet1.address,
            [transactionModule.address, amount, largeTxData, sequenceId, expireTime],
            signatures
        );
        await res.wait()
        
        console.log("555")

        let user3EndEther = (await provider.getBalance(user3.address));
        expect(user3EndEther).eq(user3StartEther.add(amount))
    })
});
