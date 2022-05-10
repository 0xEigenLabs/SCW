const { waffle, ethers } = require('hardhat')
import { Wallet, utils, BigNumber, providers, Transaction } from 'ethers'

const chai = require('chai')
const { solidity } = require('ethereum-waffle')
chai.use(solidity)
const { expect } = chai
const hre = require('hardhat')

const { getContractAddress } = require('@ethersproject/address')

const helpers = require('./helpers')

let governanceToken
let timelock
let governorAlpha

const provider = waffle.provider

let moduleRegistry
let proxiedSerurityModule
let securityModuleProxy
let masterWallet
let wallet1
let owner
let user1
let user2
let user3
let sequenceId
let loadFixture
// let wallet
const salts = [utils.formatBytes32String('1'), utils.formatBytes32String('2')]
const SMABI = [
    'function initialize(address, uint, uint)',
    'function executeRecovery(address)',
    'function cancelRecovery(address)',
    'function triggerRecovery(address, address)',
    'function setSecurityPeriod(address, uint, uint)',
]

import SecurityModule from '../artifacts/contracts/SecurityModule.sol/SecurityModule.json'

import { Wallet__factory } from '../typechain/factories/Wallet__factory'
import { ModuleRegistry } from '../typechain/ModuleRegistry'
import { ModuleRegistry__factory } from '../typechain/factories/ModuleRegistry__factory'
import { SecurityModule__factory } from '../typechain/factories/SecurityModule__factory'

import { Contract, constants } from 'ethers'

const DELAY = 60 * 60 * 24 * 2
let lockPeriod = 5 //s
let recoveryPeriod = 120 //s
let expireTime
const delay = (ms) => new Promise((res) => setTimeout(res, ms))

describe('Governance Action', () => {
    let wallet
    before(async () => {
        owner = await ethers.getSigner()
        user1 = Wallet.createRandom().connect(provider)
        user2 = Wallet.createRandom().connect(provider)
        user3 = Wallet.createRandom().connect(provider)

        wallet = owner

        let factory = await ethers.getContractFactory('ModuleRegistry')
        moduleRegistry = await factory.deploy()
        await moduleRegistry.deployed()
        console.log('ModuleRegistry is deployed at: ', moduleRegistry.address)

        factory = await ethers.getContractFactory('SecurityModule')
        let securityModule = await factory.deploy()
        await securityModule.deployed()
        console.log('SecurityModule is deployed at: ', securityModule.address)

        factory = await ethers.getContractFactory('ModuleProxy')
        securityModuleProxy = await factory.deploy(owner.address)
        await securityModuleProxy.deployed()

        console.log(
            'The proxy of SecurityModule is deployed at: ',
            securityModuleProxy.address
        )
        console.log('Set the admin of the proxy: ', owner.address)
        await securityModuleProxy
            .connect(owner)
            .setImplementation(securityModule.address)

        console.log(
            'The proxy of SecurityModule is set with ',
            securityModule.address
        )

        proxiedSerurityModule = new ethers.Contract(
            securityModuleProxy.address,
            SecurityModule.abi,
            owner
        )

        await proxiedSerurityModule.initialize(
            moduleRegistry.address,
            lockPeriod,
            recoveryPeriod
        )
        console.log('Proxied Security Module Initialized')

        // register the proxy module
        let res = await moduleRegistry.registerModule(
            securityModuleProxy.address,
            ethers.utils.formatBytes32String('SM')
        )
        await res.wait()

        factory = await ethers.getContractFactory('Wallet')
        masterWallet = await factory.deploy()
        await masterWallet.deployed()
        console.log('master wallet', masterWallet.address)

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
        ).deploy(masterWallet.address)
        console.log('proxy address', proxy.address)
        let walletAddress = await proxy.getAddress(salts[0])
        expect(walletAddress).to.exist
        console.log('proxy wallet', walletAddress)

        const tx = await proxy.create(salts[0])
        await tx.wait()

        wallet1 = Wallet__factory.connect(walletAddress, owner)
        console.log('wallet address', wallet1.address)

        let modules = [securityModuleProxy.address]
        let encoder = ethers.utils.defaultAbiCoder
        let data = [
            encoder.encode(['address[]'], [[user1.address, user2.address]]),
        ]
        let initTx = await wallet1.initialize(modules, data)
        await initTx.wait()
    })

    let governanceToken: Contract
    let timelock: Contract
    let governorAlpha: Contract

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
        let depositAmount = ethers.utils.parseEther('0.1')
        await owner.sendTransaction({
            to: wallet1.address,
            value: depositAmount,
        })
        sequenceId = await wallet1.getNextSequenceId()

        // FIXME:
        // Every time we update a security module with proxy set implementation
        let factory = await ethers.getContractFactory('SecurityModule')
        let securityModule = await factory.deploy()
        await securityModule.deployed()
        console.log(
            'A New SecurityModule is deployed at: ',
            securityModule.address
        )

        console.log('securityModuleProxy:', securityModuleProxy.address)

        await securityModuleProxy
            .connect(owner)
            .setImplementation(securityModule.address)

        const { timestamp: now } = await provider.getBlock('latest')
        expireTime = now + 1800

        const fixture = await helpers.governanceFixture([wallet], provider)

        governanceToken = fixture.governanceToken
        timelock = fixture.timelock
        governorAlpha = fixture.governorAlpha
    })

    it('proxy could change admin by admin', async function () {
        const oldAdmin = await securityModuleProxy.admin()
        expect(oldAdmin).to.be.eq(owner.address)
        await securityModuleProxy.connect(owner).setAdmin(user1.address)
        const newAdmin = await securityModuleProxy.admin()
        expect(newAdmin).to.be.eq(user1.address)

        // Then set the admin back to 'owner'
        await securityModuleProxy.connect(user1).setAdmin(owner.address)
        const admin = await securityModuleProxy.admin()
        expect(admin).to.be.eq(owner.address)
    })

    it('proxy could not change admin by others', async function () {
        const oldAdmin = await securityModuleProxy.admin()
        expect(oldAdmin).to.be.eq(owner.address)
        await securityModuleProxy.connect(owner).setAdmin(user1.address)
        const newAdmin = await securityModuleProxy.admin()
        expect(newAdmin).to.be.eq(user1.address)

        // Then set the admin back to 'owner'
        await securityModuleProxy.connect(user1).setAdmin(owner.address)
        const admin = await securityModuleProxy.admin()
        expect(admin).to.be.eq(owner.address)

        await expect(
            securityModuleProxy.connect(user1).setAdmin(user2.address)
        ).to.be.revertedWith('MP: only admin can setAdmin')
    })

    it("proxy change security module's lock period or recovery period", async function () {
        let lp = await proxiedSerurityModule.getLockedSecurityPeriod(
            wallet1.address
        )
        let rp = await proxiedSerurityModule.getRecoverySecurityPeriod(
            wallet1.address
        )
        expect(lp).eq(5)
        expect(rp).eq(120)

        // change security parameters
        let amount = 0
        let iface = new ethers.utils.Interface(SMABI)
        let data = iface.encodeFunctionData('setSecurityPeriod', [
            wallet1.address,
            4,
            119,
        ])
        let hash = await helpers.signHash(
            proxiedSerurityModule.address,
            amount,
            data,
            /*expireTime,*/ sequenceId
        )
        let signatures = await helpers.getSignatures(
            ethers.utils.arrayify(hash),
            [user1, user2]
        )

        // When modifying security parameters, you need to call multi-signature.
        let res = await proxiedSerurityModule
            .connect(owner)
            .multicall(
                wallet1.address,
                [
                    proxiedSerurityModule.address,
                    amount,
                    data,
                    sequenceId,
                    expireTime,
                ],
                signatures
            )
        await res.wait()
        lp = await proxiedSerurityModule.getLockedSecurityPeriod(
            wallet1.address
        )
        rp = await proxiedSerurityModule.getRecoverySecurityPeriod(
            wallet1.address
        )
        expect(lp).eq(4)
        expect(rp).eq(119)

        // wait for calm-down period
        await delay(lockPeriod * 1000)

        // change back
        iface = new ethers.utils.Interface(SMABI)
        data = iface.encodeFunctionData('setSecurityPeriod', [
            wallet1.address,
            5,
            120,
        ])
        sequenceId = await wallet1.getNextSequenceId()
        hash = await helpers.signHash(
            proxiedSerurityModule.address,
            amount,
            data,
            /*expireTime,*/ sequenceId
        )
        signatures = await helpers.getSignatures(ethers.utils.arrayify(hash), [
            user1,
            user2,
        ])

        res = await proxiedSerurityModule
            .connect(owner)
            .multicall(
                wallet1.address,
                [
                    proxiedSerurityModule.address,
                    amount,
                    data,
                    sequenceId,
                    expireTime,
                ],
                signatures
            )
        await res.wait()
        //await (await securityModule.connect(owner).setSecurityPeriod(wallet1.address, 5, 120)).wait()
        lp = await proxiedSerurityModule.getLockedSecurityPeriod(
            wallet1.address
        )
        rp = await proxiedSerurityModule.getRecoverySecurityPeriod(
            wallet1.address
        )
        expect(lp).eq(5)
        expect(rp).eq(120)
    })

    it('proxy should trigger recovery', async function () {
        let sm = SecurityModule__factory.connect(
            proxiedSerurityModule.address,
            user1
        )

        let amount = 0
        let iface = new ethers.utils.Interface(SMABI)
        let data = iface.encodeFunctionData('triggerRecovery', [
            wallet1.address,
            user3.address,
        ])
        let hash = await helpers.signHash(
            proxiedSerurityModule.address,
            amount,
            data,
            /*expireTime,*/ sequenceId
        )
        let signatures = await helpers.getSignatures(
            ethers.utils.arrayify(hash),
            [user1, user2]
        )

        let res = await proxiedSerurityModule
            .connect(owner)
            .multicall(
                wallet1.address,
                [
                    proxiedSerurityModule.address,
                    amount,
                    data,
                    sequenceId,
                    expireTime,
                ],
                signatures
            )
        await res.wait()

        res = await sm.isInRecovery(wallet1.address)
        expect(res).eq(true)
        sequenceId = await wallet1.getNextSequenceId()

        iface = new ethers.utils.Interface(SMABI)
        data = iface.encodeFunctionData('cancelRecovery', [wallet1.address])

        let tx = await proxiedSerurityModule
            .connect(user3)
            .cancelRecovery(wallet1.address)
        await tx.wait()

        res = await sm.isInRecovery(wallet1.address)
        expect(res).eq(false)
    })

    it('proxy should revert recovery', async function () {
        let amount = 0
        let iface = new ethers.utils.Interface(SMABI)
        let data = iface.encodeFunctionData('triggerRecovery', [
            wallet1.address,
            user3.address,
        ])
        let hash = await helpers.signHash(
            proxiedSerurityModule.address,
            amount,
            data,
            /*expireTime,*/ sequenceId
        )
        let signatures = await helpers.getSignatures(
            ethers.utils.arrayify(hash),
            [user1, user2]
        )

        await expect(
            proxiedSerurityModule
                .connect(user3)
                .multicall(
                    wallet1.address,
                    [
                        proxiedSerurityModule.address,
                        amount,
                        data,
                        sequenceId,
                        expireTime,
                    ],
                    signatures
                )
        ).to.be.revertedWith('SM: must be signer/wallet')
    })

    it('proxy should execute recovery', async () => {
        let res1 = await proxiedSerurityModule.isSigner(
            wallet1.address,
            user1.address
        )
        expect(res1).eq(true)
        res1 = await proxiedSerurityModule.isSigner(
            wallet1.address,
            user2.address
        )
        expect(res1).eq(true)

        res1 = await proxiedSerurityModule.isSigner(
            wallet1.address,
            user3.address
        )
        expect(res1).eq(false)

        res1 = await wallet1.owner()
        expect(res1).eq(owner.address)

        let amount = 0
        let iface = new ethers.utils.Interface(SMABI)
        let data = iface.encodeFunctionData('triggerRecovery', [
            wallet1.address,
            user3.address,
        ])
        let hash = await helpers.signHash(
            proxiedSerurityModule.address,
            amount,
            data,
            /*expireTime,*/ sequenceId
        )
        let signatures = await helpers.getSignatures(
            ethers.utils.arrayify(hash),
            [user1, user2]
        )

        let res = await proxiedSerurityModule
            .connect(owner)
            .multicall(
                wallet1.address,
                [
                    proxiedSerurityModule.address,
                    amount,
                    data,
                    sequenceId,
                    expireTime,
                ],
                signatures
            )
        await res.wait()

        // the new owner executes recovery
        let tx = await proxiedSerurityModule
            .connect(user3)
            .executeRecovery(wallet1.address)
        await tx.wait()
        res1 = await wallet1.owner()
        expect(res1).eq(user3.address)
    })

    it('proxy should lock', async () => {
        let tx = await proxiedSerurityModule
            .connect(user1)
            .lock(wallet1.address)
        await tx.wait()

        await expect(
            proxiedSerurityModule.lock(wallet1.address)
        ).to.be.revertedWith('SM: must be signer/wallet')

        await expect(
            proxiedSerurityModule.connect(user1).lock(wallet1.address)
        ).to.be.revertedWith('BM: wallet locked globally')

        tx = await proxiedSerurityModule.connect(user1).unlock(wallet1.address)
        await tx.wait()
    })

    it('proxy should change signer', async () => {
        // The owner is user3
        let res1 = await proxiedSerurityModule.isSigner(
            wallet1.address,
            user1.address
        )
        expect(res1).eq(true)
        res1 = await proxiedSerurityModule.isSigner(
            wallet1.address,
            user2.address
        )
        expect(res1).eq(true)
        let tx = await proxiedSerurityModule
            .connect(user3)
            .replaceSigner(wallet1.address, owner.address, user1.address)
        await tx.wait()

        //wait for calm-down period
        await delay(lockPeriod * 1000)

        res1 = await proxiedSerurityModule.isSigner(
            wallet1.address,
            user1.address
        )
        expect(res1).eq(false)
        res1 = await proxiedSerurityModule.isSigner(
            wallet1.address,
            user2.address
        )
        expect(res1).eq(true)
        res1 = await proxiedSerurityModule.isSigner(
            wallet1.address,
            owner.address
        )
        expect(res1).eq(true)
    })

    it('proxy should remove signer', async () => {
        let res1 = await proxiedSerurityModule.isSigner(
            wallet1.address,
            user2.address
        )
        expect(res1).eq(true)
        let tx = await proxiedSerurityModule
            .connect(user3)
            .removeSigner(wallet1.address, user2.address)
        await tx.wait()

        //wait for calm-down period
        await delay(lockPeriod * 1000)

        res1 = await proxiedSerurityModule.isSigner(
            wallet1.address,
            user1.address
        )
        expect(res1).eq(false)
        res1 = await proxiedSerurityModule.isSigner(
            wallet1.address,
            user2.address
        )
        expect(res1).eq(false)
        res1 = await proxiedSerurityModule.isSigner(
            wallet1.address,
            owner.address
        )
        expect(res1).eq(true)
    })

    it('proxy should add signer', async () => {
        // add user1 to signer
        let res1 = await proxiedSerurityModule.isSigner(
            wallet1.address,
            user1.address
        )
        expect(res1).eq(false)
        let tx = await proxiedSerurityModule
            .connect(user3)
            .addSigner(wallet1.address, user2.address)
        await tx.wait()
        res1 = await proxiedSerurityModule.isSigner(
            wallet1.address,
            user1.address
        )
        expect(res1).eq(false)

        await expect(
            proxiedSerurityModule
                .connect(user3)
                .addSigner(wallet1.address, user1.address)
        ).to.be.revertedWith('BM: wallet locked by signer related operation')

        // test lock: we can call lock to add global lock even though addSigner had added a signer related lock.
        tx = await proxiedSerurityModule.connect(user3).lock(wallet1.address)
        //await tx.wait()

        let lockFlag = await proxiedSerurityModule.isLocked(wallet1.address)
        expect(lockFlag).eq(3)

        //wait for calm-down period
        await delay(lockPeriod * 1000)

        tx = await proxiedSerurityModule
            .connect(user3)
            .addSigner(wallet1.address, user1.address)
        await tx.wait()
        res1 = await proxiedSerurityModule.isSigner(
            wallet1.address,
            user1.address
        )
        expect(res1).eq(true)
        res1 = await proxiedSerurityModule.isSigner(
            wallet1.address,
            user2.address
        )
        expect(res1).eq(true)
        res1 = await proxiedSerurityModule.isSigner(
            wallet1.address,
            owner.address
        )
        expect(res1).eq(true)
    })

    it('proxy test lock', async () => {
        let tx = await proxiedSerurityModule
            .connect(user3)
            .lock(wallet1.address)
        await tx.wait()

        // When the user call the global lock, he or she can't add other locks until the global lock is released.
        await expect(
            proxiedSerurityModule
                .connect(user3)
                .removeSigner(wallet1.address, user1.address)
        ).to.be.revertedWith('BM: wallet locked globally')
    })

    it('should add proposal', async () => {
        // A proposal need to deploy the target contract before adding it
        let factory = await ethers.getContractFactory('SecurityModule')
        let securityModule = await factory.deploy()
        await securityModule.deployed()

        factory = await ethers.getContractFactory('ModuleProxy')
        // It is timelock to execute the proposal, so the admin should be timelock
        securityModuleProxy = await factory.deploy(timelock.address)
        await securityModuleProxy.deployed()

        const target = securityModuleProxy.address
        const value = 0
        const signature = 'setImplementation(address)'
        const calldata = utils.defaultAbiCoder.encode(
            ['address'],
            [securityModule.address]
        )
        const description = 'This is a test proposal'

        // activate balances
        await governanceToken.delegate(wallet.address)
        const { timestamp: now } = await provider.getBlock('latest')
        await helpers.mineBlock(provider, now)

        const proposalId = await governorAlpha.callStatic.propose(
            [target],
            [value],
            [signature],
            [calldata],
            description
        )

        const tx = await governorAlpha.propose(
            [target],
            [value],
            [signature],
            [calldata],
            description
        )

        await tx.wait()

        console.log('The proposal id is ', proposalId)

        expect(proposalId).gt(0)
    })

    it('update a new security module with GovernanceAlpha', async () => {
        let factory = await ethers.getContractFactory('SecurityModule')
        let securityModule = await factory.deploy()
        await securityModule.deployed()
        console.log(
            'A New SecurityModule is deployed at: ',
            securityModule.address
        )

        factory = await ethers.getContractFactory('ModuleProxy')
        // It is timelock to execute the proposal, so the admin should be timelock
        securityModuleProxy = await factory.deploy(timelock.address)
        await securityModuleProxy.deployed()

        console.log(
            'The proxy of SecurityModule is deployed at: ',
            securityModuleProxy.address
        )

        const target = securityModuleProxy.address
        const value = 0
        const signature = 'setImplementation(address)'
        const calldata = utils.defaultAbiCoder.encode(
            ['address'],
            [securityModule.address]
        )
        const description = 'Update a new Security Module'

        // activate balances
        await governanceToken.delegate(wallet.address)
        const { timestamp: now } = await provider.getBlock('latest')
        await helpers.mineBlock(provider, now)
        const proposalId = await governorAlpha.callStatic.propose(
            [target],
            [value],
            [signature],
            [calldata],
            description
        )
        console.log('The proposal id is ', proposalId)
        await governorAlpha.propose(
            [target],
            [value],
            [signature],
            [calldata],
            description
        )

        // overcome votingDelay
        await helpers.mineBlock(provider, now)

        console.log('castVote true for the proposal')
        await governorAlpha.castVote(proposalId, true)

        const votingPeriod = await governorAlpha
            .votingPeriod()
            .then((votingPeriod: BigNumber) => votingPeriod.toNumber())
        console.log('Voting period is ', votingPeriod)
        // TODO fix if possible, this is really annoying
        // overcome votingPeriod
        for (let i = 0; i <= votingPeriod; i++) {
            await helpers.mineBlock(provider, now)
        }

        console.log('queue the proposal')
        await governorAlpha.queue(proposalId)

        const eta = now + DELAY + 60 // give a minute margin
        await helpers.mineBlock(provider, eta)
        console.log('execute the proposal')
        await governorAlpha.execute(proposalId)

        const impl = await securityModuleProxy.getImplementation()
        expect(impl).to.be.eq(securityModule.address)
    }).timeout(500000)
})
