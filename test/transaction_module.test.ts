/**
 * Copyright 2021-2022 Eigen Network
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { waffle, ethers } = require('hardhat')
import { Wallet, utils } from 'ethers'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chai = require('chai')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { solidity } = require('ethereum-waffle')
chai.use(solidity)
const { expect } = chai
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hre = require('hardhat')

import { Wallet__factory } from '../typechain/factories/Wallet__factory'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const helpers = require('./helpers')

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
const TMABI = [
    'function executeTransaction(address)',
    'function executeLargeTransaction(address, address, uint, bytes)',
    'function setTMParameter(address, uint, uint)',
    'function addModule(address, address, address, bytes)',
]

const lockPeriod = 5 //s
const recoveryPeriod = 120 //s
let expireTime

describe('Transaction test', () => {
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
        const res1 = await moduleRegistry.registerModule(
            securityModule.address,
            ethers.utils.formatBytes32String('SM')
        )
        await res1.wait()

        factory = await ethers.getContractFactory('Wallet')
        masterWallet = await factory.deploy()
        await masterWallet.deployed()
        console.log('master wallet', masterWallet.address)

        // FIXME
        owner = await ethers.getSigner()
        user1 = Wallet.createRandom().connect(provider)
        user2 = Wallet.createRandom().connect(provider)
        user3 = Wallet.createRandom().connect(provider)

        console.log('unsorted', user1.address, user2.address, user3.address)
        const signers = [user1, user2, user3]
        signers.sort(function (a, b) {
            return a.address - b.address
        })
        user1 = signers[0]
        user2 = signers[1]
        user3 = signers[2]

        console.log('sorted', user1.address, user2.address, user3.address)

        const proxy = await (
            await ethers.getContractFactory('Proxy')
        ).deploy(masterWallet.address)
        console.log('proxy address', proxy.address)
        const salt = utils.formatBytes32String(
            utils.sha256(utils.randomBytes(32)).substr(2, 31)
        )
        const walletAddress = await proxy.getAddress(salt)
        expect(walletAddress).to.exist
        console.log('proxy wallet', walletAddress)

        const tx = await proxy.create(salt)
        await tx.wait()

        wallet1 = Wallet__factory.connect(walletAddress, owner)
        console.log('wallet address', wallet1.address)

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
            await owner.sendTransaction({
                to: wallet1.address,
                value: ethers.utils.parseEther('1.2'),
            })
        ).wait()
        const encoder = ethers.utils.defaultAbiCoder
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

        const du = ethers.utils.parseEther('15')
        const lap = ethers.utils.parseEther('10')
        const tmData = encoder.encode(['uint', 'uint'], [du, lap])

        const amount = 0
        const iface = new ethers.utils.Interface(TMABI)
        const data = iface.encodeFunctionData('addModule', [
            moduleRegistry.address,
            wallet1.address,
            transactionModule.address,
            tmData,
        ])
        sequenceId = await wallet1.getNextSequenceId()
        const { timestamp: now } = await provider.getBlock('latest')
        expireTime = now + 1800
        const hash = await helpers.signHash(
            transactionModule.address,
            amount,
            data,
            /*expireTime,*/ sequenceId
        )
        const signatures = await helpers.getSignatures(
            ethers.utils.arrayify(hash),
            [user1, user2]
        )

        // When authorising module, you need to call multi-signature.
        res = await securityModule
            .connect(owner)
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
        console.log('Wallet created', wallet1.address)
    })

    beforeEach(async function () {
        await (
            await owner.sendTransaction({
                to: user1.address,
                value: ethers.utils.parseEther('0.01'),
            })
        ).wait()
        await (
            await owner.sendTransaction({
                to: user2.address,
                value: ethers.utils.parseEther('0.01'),
            })
        ).wait()
        await (
            await owner.sendTransaction({
                to: user3.address,
                value: ethers.utils.parseEther('0.01'),
            })
        ).wait()
        // deposit to wallet
        const depositAmount = ethers.utils.parseEther('0.1')
        await owner.sendTransaction({
            to: wallet1.address,
            value: depositAmount,
        })
        sequenceId = await wallet1.getNextSequenceId()
        const { timestamp: now } = await provider.getBlock('latest')
        expireTime = now + 1800
    })

    it("change transaction module's daily upbound or large amount payment", async function () {
        let du = await transactionModule.getDailyUpbound(wallet1.address)
        let lap = await transactionModule.getLargeAmountPayment(wallet1.address)
        expect(du).eq(ethers.utils.parseEther('15'))
        expect(lap).eq(ethers.utils.parseEther('10'))

        // change transaction parameters
        const amount = 0
        let iface = new ethers.utils.Interface(TMABI)
        let data = iface.encodeFunctionData('setTMParameter', [
            wallet1.address,
            ethers.utils.parseEther('14'),
            ethers.utils.parseEther('9'),
        ])
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

        // When modifying security parameters, you need to call multi-signature.
        let res = await securityModule
            .connect(owner)
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

        // await (await transactionModule.connect(owner).setTMParameter(wallet1.address, ethers.utils.parseEther("14"), ethers.utils.parseEther("9"))).wait()
        du = await transactionModule.getDailyUpbound(wallet1.address)
        lap = await transactionModule.getLargeAmountPayment(wallet1.address)
        expect(du).eq(ethers.utils.parseEther('14'))
        expect(lap).eq(ethers.utils.parseEther('9'))

        // change back
        iface = new ethers.utils.Interface(TMABI)
        data = iface.encodeFunctionData('setTMParameter', [
            wallet1.address,
            ethers.utils.parseEther('15'),
            ethers.utils.parseEther('10'),
        ])
        sequenceId = await wallet1.getNextSequenceId()
        hash = await helpers.signHash(
            transactionModule.address,
            amount,
            data,
            /*expireTime,*/ sequenceId
        )
        signatures = await helpers.getSignatures(ethers.utils.arrayify(hash), [
            user1,
            user2,
        ])

        res = await securityModule
            .connect(owner)
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

        // await (await transactionModule.connect(owner).setTMParameter(wallet1.address, ethers.utils.parseEther("15"), ethers.utils.parseEther("10"))).wait()
        du = await transactionModule.getDailyUpbound(wallet1.address)
        lap = await transactionModule.getLargeAmountPayment(wallet1.address)
        expect(du).eq(ethers.utils.parseEther('15'))
        expect(lap).eq(ethers.utils.parseEther('10'))
    })

    it('execute transaction test', async function () {
        console.log(owner.address)
        await (
            await owner.sendTransaction({
                to: wallet1.address,
                value: ethers.utils.parseEther('0.01'),
            })
        ).wait()
        const user3StartEther = await provider.getBalance(user3.address)

        console.log(user3StartEther.toString())
        const amount = ethers.utils.parseEther('0.01')
        sequenceId = await wallet1.getNextSequenceId()

        const res = await transactionModule
            .connect(owner)
            .executeTransaction(wallet1.address, [
                user3.address,
                amount,
                '0x',
                sequenceId,
                expireTime,
            ])
        await res.wait()

        const user3EndEther = await provider.getBalance(user3.address)
        expect(user3EndEther).eq(user3StartEther.add(amount))
    })

    it('execute ERC20 token transaction test', async function () {
        console.log(owner.address)

        const erc20Artifact = await hre.artifacts.readArtifact('TestToken')
        const TestTokenABI = erc20Artifact.abi

        const ownerContract = new ethers.Contract(
            testToken.address,
            TestTokenABI,
            owner
        )
        const ownerBalance = (
            await ownerContract.balanceOf(owner.address)
        ).toString()
        console.log('owner balance', ownerBalance)

        await (await ownerContract.transfer(wallet1.address, 10)).wait()

        const user3Contract = new ethers.Contract(
            testToken.address,
            TestTokenABI,
            user3
        )
        const user3StartBalance = await user3Contract.balanceOf(user3.address)
        console.log('user3StartBalance ', user3StartBalance.toString())

        const amount = 1
        sequenceId = await wallet1.getNextSequenceId()
        const iface = new ethers.utils.Interface(TestTokenABI)
        const txData = iface.encodeFunctionData('transfer', [
            user3.address,
            amount,
        ])

        const res = await transactionModule
            .connect(owner)
            .executeTransaction(wallet1.address, [
                testToken.address,
                0,
                txData,
                sequenceId,
                expireTime,
            ])
        await res.wait()

        const user3EndBalance = await user3Contract.balanceOf(user3.address)
        console.log('user3EndBalance ', user3EndBalance.toString())
        expect(user3EndBalance).eq(user3StartBalance.add(amount))
    })

    it('execute large transaction test', async function () {
        await (
            await owner.sendTransaction({
                to: wallet1.address,
                value: ethers.utils.parseEther('16'),
            })
        ).wait()

        const user3StartEther = await provider.getBalance(user3.address)
        console.log(user3StartEther.toString())

        const amount = ethers.utils.parseEther('11')
        const amountMulti = 0
        sequenceId = await wallet1.getNextSequenceId()
        const iface = new ethers.utils.Interface(TMABI)
        const largeTxData = iface.encodeFunctionData(
            'executeLargeTransaction',
            [wallet1.address, user3.address, amount, '0x']
        )
        const hash = await helpers.signHash(
            transactionModule.address,
            amountMulti,
            largeTxData,
            /*expireTime,*/ sequenceId
        )
        const signatures = await helpers.getSignatures(
            ethers.utils.arrayify(hash),
            [user1, user2]
        )

        const res = await securityModule
            .connect(owner)
            .multicall(
                wallet1.address,
                [
                    transactionModule.address,
                    amountMulti,
                    largeTxData,
                    sequenceId,
                    expireTime,
                ],
                signatures
            )
        await res.wait()

        const user3EndEther = await provider.getBalance(user3.address)
        console.log(user3EndEther.toString())
        expect(user3EndEther).eq(user3StartEther.add(amount))
    })

    it('test lock', async () => {
        const tx = await securityModule.connect(owner).lock(wallet1.address)
        await tx.wait()

        // When the user call the global lock, he or she can't call executeTransaction until the global lock is released.
        const amount = ethers.utils.parseEther('0.01')
        sequenceId = await wallet1.getNextSequenceId()

        expect(
            transactionModule
                .connect(owner)
                .executeTransaction(wallet1.address, [
                    user3.address,
                    amount,
                    '0x',
                    sequenceId,
                    expireTime,
                ])
        ).to.be.revertedWith('BM: wallet locked globally')
    })

    it('daily limit check test', async function () {
        // In the last test case, wallet1 transferred 11 eth to user3, and in this test case wallet1 transferred 5 eth to user3. This transfer triggered the daily limit.
        const amount = ethers.utils.parseEther('5')
        sequenceId = await wallet1.getNextSequenceId()

        await expect(
            transactionModule
                .connect(owner)
                .executeTransaction(wallet1.address, [
                    user3.address,
                    amount,
                    '0x',
                    sequenceId,
                    expireTime,
                ])
        ).to.be.revertedWith('TM:Daily limit reached')
    })
})
