// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.

const { waffle, ethers } = require('hardhat')
import {
    Contract,
    Wallet,
    utils,
    BigNumber,
    providers,
    Transaction,
} from 'ethers'

const chai = require('chai')
const { solidity } = require('ethereum-waffle')
chai.use(solidity)
const { expect } = chai
const hre = require('hardhat')

import { resolve } from 'path'
import { config as dotenvConfig } from 'dotenv'
dotenvConfig({ path: resolve(__dirname, './.env') })

import { ModuleRegistry } from '../typechain/ModuleRegistry'
import { ModuleRegistry__factory } from '../typechain/factories/ModuleRegistry__factory'
import { SecurityModule__factory } from '../typechain/factories/SecurityModule__factory'
import { TransactionModule__factory } from '../typechain/factories/TransactionModule__factory'
import { Wallet__factory } from '../typechain/factories/Wallet__factory'
import { BaseModule__factory } from '../typechain/factories/BaseModule__factory'

import SecurityModule from '../artifacts/contracts/SecurityModule.sol/SecurityModule.json'
import TransactionModule from '../artifacts/contracts/TransactionModule.sol/TransactionModule.json'

const helpers = require('../test/helpers')
const provider = waffle.provider

let moduleRegistry
let testToken
let governanceToken
let timelock
let governorAlpha
let proxiedSecurityModule
let securityModuleProxy
let proxiedTransactionModule
let transactionModuleProxy
let masterWallet
let wallet1
let owner
let user1
let user2
let user3
let sequenceId
const salts = [utils.formatBytes32String('1'), utils.formatBytes32String('2')]
const TMABI = [
    'function executeTransaction(address)',
    'function executeLargeTransaction(address, address, uint, bytes)',
    'function addModule(address, address, address, bytes)',
]

let lockPeriod = 172800 //s
let recoveryPeriod = 172800 //s
let expireTime = Math.floor(new Date().getTime() / 1000) + 1800 // 60 seconds
const DELAY = 60 * 60 * 24 * 2

async function main() {
    // Hardhat always runs the compile task when running scripts with its command
    // line interface.
    //
    // If this script is run directly using `node` you may want to call compile
    // manually to make sure everything is compiled
    // await hre.run('compile');

    // We get the contract to deploy
    // FIXME
    owner = await ethers.getSigner()
    user1 = Wallet.createRandom().connect(provider)
    user2 = Wallet.createRandom().connect(provider)
    user3 = Wallet.createRandom().connect(provider)

    // Firstly, deploy governance contracts
    const { timestamp: now } = await provider.getBlock('latest')
    let transactionCount = await owner.getTransactionCount()

    const timelockAddress = Contract.getContractAddress({
        from: owner.address,
        nonce: transactionCount + 1,
    })

    let factory = await ethers.getContractFactory('GovernanceToken')
    if (process.env['GOVERNANCE_TOKEN']) {
        const GovernanceTokenArtifact = await hre.artifacts.readArtifact(
            'GovernanceToken'
        )
        const GovernanceTokenABI = GovernanceTokenArtifact.abi
        governanceToken = new ethers.Contract(
            process.env['GOVERNANCE_TOKEN'],
            GovernanceTokenABI,
            owner
        )
        console.log('GovernanceToken has been deployed before')
    } else {
        governanceToken = await factory.deploy(
            owner.address,
            timelockAddress,
            now + 60 * 60
        )
        await governanceToken.deployed()
        console.log('GovernanceToken is now newly deployed')
        console.log(
            `GovernanceToken ${governanceToken.address} constructor(${
                owner.address
            }, ${timelockAddress}, ${now + 60 * 60})`
        )
    }

    console.log('GovernanceToken ', governanceToken.address)

    transactionCount = await owner.getTransactionCount()

    // deploy timelock, controlled by what will be the governor
    const governorAlphaAddress = Contract.getContractAddress({
        from: owner.address,
        nonce: transactionCount + 1,
    })
    factory = await ethers.getContractFactory('Timelock')
    if (process.env['TIMELOCK']) {
        const TimelockArtifact = await hre.artifacts.readArtifact('Timelock')
        const TimelockABI = TimelockArtifact.abi
        timelock = new ethers.Contract(
            process.env['TIMELOCK'],
            TimelockABI,
            owner
        )
        console.log('Timelock has been deployed before')
    } else {
        timelock = await factory.deploy(governorAlphaAddress, DELAY)
        await timelock.deployed()
        expect(timelock.address).to.be.eq(timelockAddress)
        console.log('Timelock is now newly deployed')
        console.log(
            `Timelock ${timelock.address} constructor(${governorAlphaAddress}, ${DELAY})`
        )
    }

    console.log('Timelock ', timelock.address)

    // deploy governorAlpha
    factory = await ethers.getContractFactory('GovernorAlpha')
    if (process.env['GOVERNOR_ALPHA']) {
        const GovernorAlphaArtifact = await hre.artifacts.readArtifact(
            'GovernorAlpha'
        )
        const GovernorAlphaABI = GovernorAlphaArtifact.abi
        governorAlpha = new ethers.Contract(
            process.env['GOVERNOR_ALPHA'],
            GovernorAlphaABI,
            owner
        )
        console.log('GovernorAlpha has been deployed before')
    } else {
        governorAlpha = await factory.deploy(
            timelock.address,
            governanceToken.address
        )
        await governorAlpha.deployed()
        expect(governorAlpha.address).to.be.eq(governorAlphaAddress)
        console.log('GovernorAlpha is now newly deployed')
        console.log(
            `GovernorAlpha ${governorAlpha.address} constructor(${timelock.address}, ${governanceToken.address})`
        )
    }
    console.log('GovernorAlpha ', governorAlpha.address)

    factory = await ethers.getContractFactory('ModuleRegistry')
    moduleRegistry = await factory.deploy()
    await moduleRegistry.deployed()

    factory = await ethers.getContractFactory('SecurityModule')
    let securityModule = await factory.deploy()
    await securityModule.deployed()

    factory = await ethers.getContractFactory('TransactionModule')
    let transactionModule = await factory.deploy()
    await transactionModule.deployed()

    factory = await ethers.getContractFactory('ModuleProxy')
    securityModuleProxy = await factory.deploy(owner.address)
    await securityModuleProxy.deployed()

    console.log(
        'Set the admin of the securityModuleProxy (now the owner): ',
        owner.address
    )
    await securityModuleProxy
        .connect(owner)
        .setImplementation(securityModule.address)

    console.log(
        'The proxy of SecurityModule is set with ',
        securityModule.address
    )

    factory = await ethers.getContractFactory('ModuleProxy')
    transactionModuleProxy = await factory.deploy(owner.address)
    await transactionModuleProxy.deployed()

    console.log(
        'Set the admin of the transactionModuleProxy (now the owner): ',
        owner.address
    )
    await transactionModuleProxy
        .connect(owner)
        .setImplementation(transactionModule.address)

    console.log(
        'The proxy of TransactionModule is set with ',
        transactionModule.address
    )

    factory = await ethers.getContractFactory('TestToken')
    testToken = await factory.deploy(100000)
    await testToken.deployed()
    console.log('testToken address', testToken.address)

    proxiedSecurityModule = new ethers.Contract(
        securityModuleProxy.address,
        SecurityModule.abi,
        owner
    )

    await proxiedSecurityModule.initialize(
        moduleRegistry.address,
        lockPeriod,
        recoveryPeriod
    )
    console.log('security module', proxiedSecurityModule.address)

    proxiedTransactionModule = new ethers.Contract(
        transactionModuleProxy.address,
        TransactionModule.abi,
        owner
    )

    await proxiedTransactionModule.initialize(moduleRegistry.address)
    console.log('transaction module', proxiedTransactionModule.address)

    // register the module
    let res = await moduleRegistry.registerModule(
        proxiedTransactionModule.address,
        ethers.utils.formatBytes32String('TM')
    )
    await res.wait()
    let res1 = await moduleRegistry.registerModule(
        proxiedSecurityModule.address,
        ethers.utils.formatBytes32String('SM')
    )
    await res1.wait()

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

    let proxy = await (await ethers.getContractFactory('Proxy')).deploy(
        masterWallet.address
    )
    console.log('proxy address', proxy.address)
    let walletAddress = await proxy.getAddress(salts[0])
    expect(walletAddress).to.exist
    console.log('proxy wallet', walletAddress)

    const tx = await proxy.create(salts[0])
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
            value: ethers.utils.parseEther('0.5'),
        })
    ).wait()
    let encoder = ethers.utils.defaultAbiCoder
    // You must initialize the wallet with at least one module.
    await (
        await wallet1.initialize(
            [proxiedSecurityModule.address],
            [encoder.encode(['address[]'], [[user1.address, user2.address]])]
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
        proxiedTransactionModule.address,
        tmData,
    ])
    sequenceId = await wallet1.getNextSequenceId()
    let hash = await helpers.signHash(
        proxiedTransactionModule.address,
        amount,
        data,
        /*expireTime,*/ sequenceId
    )
    let signatures = await helpers.getSignatures(ethers.utils.arrayify(hash), [
        user1,
        user2,
    ])

    // When authorising module, you need to call multi-signature.
    res = await proxiedSecurityModule
        .connect(owner)
        .multicall(
            wallet1.address,
            [
                proxiedTransactionModule.address,
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

    // Finally, change the admin of the proxies into timelock
    console.log('Change the admin for proxies: ')
    console.log('                              from: ', owner.address)
    console.log(
        '                              to (timelock): ',
        timelock.address
    )
    let oldAdmin = await securityModuleProxy.admin()
    expect(oldAdmin).to.be.eq(owner.address)
    res = await securityModuleProxy.connect(owner).setAdmin(timelock.address)
    await res.wait()
    let newAdmin = await securityModuleProxy.admin()
    expect(newAdmin).to.be.eq(timelock.address)

    oldAdmin = await transactionModuleProxy.admin()
    expect(oldAdmin).to.be.eq(owner.address)
    res = await transactionModuleProxy.connect(owner).setAdmin(timelock.address)
    await res.wait()
    newAdmin = await transactionModuleProxy.admin()
    expect(newAdmin).to.be.eq(timelock.address)

    console.log({
        GovernanceToken: governanceToken.address,
        Timelock: timelock.address,
        GovernorAlpha: governorAlpha.address,
        SecurityModule: securityModuleProxy.address,
        TransactionModule: transactionModuleProxy.address,
        TestToken: testToken.address,
        Proxy: proxy.address,
    })
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
