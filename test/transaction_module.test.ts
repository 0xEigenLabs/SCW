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

        let modules = [ transactionModule.address ]
        let encoder = ethers.utils.defaultAbiCoder
        let data = [encoder.encode(["uint", "uint"], [10, 2])]
        let initTx = await wallet1.initialize(modules, data);
        await initTx.wait()
    })

    it("execute transaction test", async function() {
        console.log(owner.address)
        console.log("111")
        let user3StartEther = await provider.getBalance(user3.address);
        let amount = 1
        console.log("222")
        sequenceId = await wallet1.getNextSequenceId()
        
        console.log("333")
        let res = await transactionModule.connect(owner).executeTransaction(
            wallet1.address,
            [user3.address, amount, "0x", sequenceId, expireTime]
        );
        await res.wait()
        
        console.log("444")
        let user3EndEther = (await provider.getBalance(user3.address));
        expect(user3EndEther).eq(user3StartEther.add(amount))
    });

    it("execute large transaction test", async function() {
        let user3StartEther = await provider.getBalance(user3.address);

        let res1 = await transactionModule.connect(wallet1).init(wallet1)

        let sm = SecurityModule__factory.connect(securityModule.address, user1)

        let amount = 3
        sequenceId = await wallet1.getNextSequenceId()
        let iface = new ethers.utils.Interface(TMABI)
        let largeTxData = iface.encodeFunctionData("executeLargeTransaction", [user3.address, amount, , sequenceId, expireTime])
        let hash = await helpers.signHash(securityModule.address, amount, largeTxData, /*expireTime,*/ sequenceId)
        let signatures = await helpers.getSignatures(ethers.utils.arrayify(hash), [user1, user2])

        let res = await securityModule.connect(owner).multicall(
            wallet1.address,
            [securityModule.address, amount, largeTxData, sequenceId, expireTime],
            signatures
        );
        await res.wait()

        // let res1 = await transactionModule.connect(owner).executeLargeTransaction(wallet1.address, user3.address, amount, data]);
        // await res1.wait()

        let user3EndEther = (await provider.getBalance(user3.address));
        expect(user3EndEther).eq(user3StartEther.add(amount))
    })
});