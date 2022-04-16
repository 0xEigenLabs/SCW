const { waffle, ethers } = require('hardhat')
import { Wallet, utils, BigNumber, providers, Transaction } from 'ethers'

const chai = require('chai')
const { solidity } = require('ethereum-waffle')
chai.use(solidity)
const { expect } = chai
const hre = require('hardhat')

import { ModuleRegistry } from '../typechain/ModuleRegistry'
import { ModuleRegistry__factory } from '../typechain/factories/ModuleRegistry__factory'
import { SecurityModule__factory } from '../typechain/factories/SecurityModule__factory'
import { TransactionModule__factory } from '../typechain/factories/TransactionModule__factory'
import { Wallet__factory } from '../typechain/factories/Wallet__factory'
import { BaseModule__factory } from '../typechain/factories/BaseModule__factory'
import { UpgradeModule__factory } from '../typechain/factories/UpgradeModule__factory'

const helpers = require('./helpers')

const provider = waffle.provider

let moduleRegistry
let transactionModule
let securityModule
let testToken
let governancerWallet
let wallet1
let governancer
let user1
let user2
let user3
let anyUser
let sequenceId
let upgradeModule

const salts = [utils.formatBytes32String('1'), utils.formatBytes32String('2')]
const TMABI = [
    'function executeTransaction(address)',
    'function executeLargeTransaction(address, address, uint, bytes)',
    'function setTMParameter(address, uint, uint)',
    'function addModule(address, address, address, bytes)',
]

let lockPeriod = 5 //s
let recoveryPeriod = 120 //s
let expireTime = Math.floor(new Date().getTime() / 1000) + 1800 // 60 seconds
const delay = (ms) => new Promise((res) => setTimeout(res, ms))

describe('UpgradeModule test', () => {
    before(async () => {
        let factory = await ethers.getContractFactory('ModuleRegistry')
        moduleRegistry = await factory.deploy()
        await moduleRegistry.deployed()

        factory = await ethers.getContractFactory('SecurityModule')
        securityModule = await factory.deploy()
        await securityModule.deployed()

        factory = await ethers.getContractFactory('TransactionModule')
        transactionModule = await factory.deploy()
        await transactionModule.deployed()

        factory = await ethers.getContractFactory('TestToken')
        testToken = await factory.deploy(100000)
        await testToken.deployed()
        console.log('testToken address', testToken.address)

        await securityModule.initialize(
            moduleRegistry.address,
            lockPeriod,
            recoveryPeriod
        )
        console.log('secure module', securityModule.address)

        await transactionModule.initialize(moduleRegistry.address)
        console.log('transaction module', transactionModule.address)

        // register the module
        let res = await moduleRegistry.registerModule(
            transactionModule.address,
            ethers.utils.formatBytes32String('TM')
        )
        await res.wait()
        let res1 = await moduleRegistry.registerModule(
            securityModule.address,
            ethers.utils.formatBytes32String('SM')
        )
        await res1.wait()

        factory = await ethers.getContractFactory('Wallet')
        governancerWallet = await factory.deploy()
        await governancerWallet.deployed()
        console.log('governancer wallet', governancerWallet.address)

        governancer = await ethers.getSigner()
        user1 = Wallet.createRandom().connect(provider)
        user2 = Wallet.createRandom().connect(provider)
        user3 = Wallet.createRandom().connect(provider)

        console.log('unsorted', user1.address, user2.address, user3.address)
        let signers = [user1, user2, user3]
        signers.sort(function (a, b) {
            return a.address - b.address
        })
        user1 = signers[0]
        user2 = signers[1]
        user3 = signers[2]

        console.log('sorted', user1.address, user2.address, user3.address)

        let proxy = await (
            await ethers.getContractFactory('Proxy')
        ).deploy(governancerWallet.address)
        console.log('proxy address', proxy.address)
        let walletAddress = await proxy.getAddress(salts[0])
        expect(walletAddress).to.exist
        console.log('proxy wallet', walletAddress)

        const tx = await proxy.create(salts[0])
        await tx.wait()

        wallet1 = Wallet__factory.connect(walletAddress, governancer)
        console.log('governancer wallet address', wallet1.address)

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
        await (
            await governancer.sendTransaction({
                to: wallet1.address,
                value: ethers.utils.parseEther('1.2'),
            })
        ).wait()
        let encoder = ethers.utils.defaultAbiCoder
        // You must initialize the wallet with at least one module.And if you want to authorise another module, you need to call multi-signature, which means securityModule is a must.
        await (
            await wallet1.initialize(
                [securityModule.address],
                [
                    encoder.encode(
                        ['address[]'],
                        [[user1.address, user2.address]]
                    ),
                ]
            )
        ).wait()

        let du = ethers.utils.parseEther('15')
        let lap = ethers.utils.parseEther('10')
        let tmData = encoder.encode(['uint', 'uint'], [du, lap])

        let amount = 0
        let iface = new ethers.utils.Interface(TMABI)
        let data = iface.encodeFunctionData('addModule', [
            moduleRegistry.address,
            wallet1.address,
            transactionModule.address,
            tmData,
        ])
        sequenceId = await wallet1.getNextSequenceId()
        let hash = await helpers.signHash(
            transactionModule.address,
            amount,
            data,
            /*expireTime,*/ sequenceId
        )
        let signatures = await helpers.getSignatures(
            ethers.utils.arrayify(hash),
            [user1, user2]
        )

        // When authorising module, you need to call multi-signature.
        res = await securityModule
            .connect(governancer)
            .multicall(
                wallet1.address,
                [
                    transactionModule.address,
                    amount,
                    data,
                    sequenceId,
                    expireTime,
                ],
                signatures
            )
        await res.wait()

        // let res2 = await wallet1.connect(owner).authoriseModule(transactionModule.address, true, tmData)
        // await res2.wait()
        // console.log('Wallet created', wallet1.address)
    })

    beforeEach(async function () {
        await (
            await governancer.sendTransaction({
                to: user1.address,
                value: ethers.utils.parseEther('0.01'),
            })
        ).wait()
        await (
            await governancer.sendTransaction({
                to: user2.address,
                value: ethers.utils.parseEther('0.01'),
            })
        ).wait()
        await (
            await governancer.sendTransaction({
                to: user3.address,
                value: ethers.utils.parseEther('0.01'),
            })
        ).wait()
        // deposit to wallet
        let depositAmount = ethers.utils.parseEther('0.1')
        await governancer.sendTransaction({
            to: wallet1.address,
            value: depositAmount,
        })
        sequenceId = await wallet1.getNextSequenceId()
        expireTime = Math.floor(new Date().getTime() / 1000) + 1800

        let factory = await ethers.getContractFactory('UpgradeModule')
        upgradeModule = await factory.deploy()
        await upgradeModule.deployed()
        console.log('UpgradeModule address', upgradeModule.address)

        // Initialize UpgradeModule
        await upgradeModule.initialize(
            moduleRegistry.address,
            governancerWallet.address
        )

        console.log('UpgradeModule initialized')
    })

    it('should add module proxies', async function () {
        await upgradeModule
            .connect(governancerWallet)
            .addModuleProxies(
                ['TransactionModule', 'SecurityModule'],
                [transactionModule.address, securityModule.address]
            )

        console.log('Add module proxy for TransactionModule')
    })
})
