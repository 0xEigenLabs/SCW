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
import { Create2Factoory__factory } from '../typechain/factories/Create2Factoory__factory'

import SecurityModule from '../artifacts/contracts/SecurityModule.sol/SecurityModule.json'
import TransactionModule from '../artifacts/contracts/TransactionModule.sol/TransactionModule.json'

const helpers = require('../test/helpers')
const provider = waffle.provider

let create2Factory
let moduleRegistry
let testToken
let governanceToken
let timelock
let governorAlpha
let proxiedSecurityModule
let securityModuleProxy
let securityModule
let transactionModule
let transactionModuleProxy
let proxiedTransactionModule
let masterWallet
let wallet1
let proxy
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

    const SALT1 = ethers.utils.formatBytes32String(process.env['SALT1'] || '42')
    const SALT2 = ethers.utils.formatBytes32String(process.env['SALT2'] || '43')

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

    // delopy Create2Factory
    factory = await ethers.getContractFactory('Create2Factory')
    if (process.env['CREATE2_FACTORY']) {
        const Create2FactoryArtifact = await hre.artifacts.readArtifact(
            'Create2Factory'
        )
        const Create2FactoryABI = Create2FactoryArtifact.abi
        create2Factory = new ethers.Contract(
            process.env['CREATE2_FACTORY'],
            Create2FactoryABI,
            owner
        )
        console.log('Create2Factory has been deployed before')
    } else {
        create2Factory = await factory.deploy()
        await create2Factory.deployed()
        console.log('Create2Factory is now newly deployed')
        console.log(`Create2Factory ${create2Factory.address} constructor()`)
    }
    console.log('Create2Factory ', create2Factory.address)

    // delopy ModuleRegistry
    factory = await ethers.getContractFactory('ModuleRegistry')
    if (process.env['MODULE_REGISTRY']) {
        const ModuleRegistryArtifact = await hre.artifacts.readArtifact(
            'ModuleRegistry'
        )
        const ModuleRegistryABI = ModuleRegistryArtifact.abi
        moduleRegistry = new ethers.Contract(
            process.env['MODULE_REGISTRY'],
            ModuleRegistryABI,
            owner
        )
        console.log('ModuleRegistry has been deployed before')
    } else {
        const ModuleRegistryArtifact = await hre.artifacts.readArtifact(
            'ModuleRegistry'
        )
        const iface = new ethers.utils.Interface(ModuleRegistryArtifact.abi)
        const bytecode =
            ModuleRegistryArtifact.bytecode + iface.encodeDeploy([]).slice(2)
        const moduleRegistryAddress = await create2Factory.findCreate2Address(
            SALT1,
            ethers.utils.keccak256(bytecode)
        )

        // ModuleRegistry is Ownable, should transfer the ownership back to the owner from Create2Factory
        const tx = await create2Factory.deploy(owner.address, SALT1, bytecode)
        await tx.wait()

        moduleRegistry = new ethers.Contract(
            moduleRegistryAddress,
            ModuleRegistryArtifact.abi,
            owner
        )

        console.log('ModuleRegistry is now newly deployed')
        console.log(`ModuleRegistry ${moduleRegistry.address} constructor()`)
    }
    console.log('ModuleRegistry ', moduleRegistry.address)

    // delopy SecurityModule
    factory = await ethers.getContractFactory('SecurityModule')
    if (process.env['SECURITY_MODULE']) {
        const SecurityModuleArtifact = await hre.artifacts.readArtifact(
            'SecurityModule'
        )
        const SecurityModuleABI = SecurityModuleArtifact.abi
        securityModule = new ethers.Contract(
            process.env['SECURITY_MODULE'],
            SecurityModuleABI,
            owner
        )
        console.log('SecurityModule (implementation) has been deployed before')
    } else {
        const SecurityModuleArtifact = await hre.artifacts.readArtifact(
            'SecurityModule'
        )
        const iface = new ethers.utils.Interface(SecurityModuleArtifact.abi)
        const bytecode =
            SecurityModuleArtifact.bytecode + iface.encodeDeploy([]).slice(2)
        const securityModuleAddress = await create2Factory.findCreate2Address(
            SALT1,
            ethers.utils.keccak256(bytecode)
        )

        const tx = await create2Factory.deploy(
            ethers.constants.AddressZero,
            SALT1,
            bytecode
        )
        await tx.wait()

        securityModule = new ethers.Contract(
            securityModuleAddress,
            SecurityModuleArtifact.abi,
            owner
        )

        console.log('SecurityModule (implementation) is now newly deployed')
        console.log(`SecurityModule ${securityModule.address} constructor()`)
    }

    // delopy TransactionModule
    factory = await ethers.getContractFactory('TransactionModule')
    if (process.env['TRANSACATION_MODULE']) {
        const TransactionModuleArtifact = await hre.artifacts.readArtifact(
            'TransactionModule'
        )
        const TransactionModuleABI = TransactionModuleArtifact.abi
        transactionModule = new ethers.Contract(
            process.env['TRANSACATION_MODULE'],
            TransactionModuleABI,
            owner
        )
        console.log(
            'TransactionModule (implementation) has been deployed before'
        )
    } else {
        const TransactionModuleArtifact = await hre.artifacts.readArtifact(
            'TransactionModule'
        )

        const iface = new ethers.utils.Interface(TransactionModuleArtifact.abi)
        const bytecode =
            TransactionModuleArtifact.bytecode + iface.encodeDeploy([]).slice(2)
        const transactionModuleAddress = await create2Factory.findCreate2Address(
            SALT1,
            ethers.utils.keccak256(bytecode)
        )

        const tx = await create2Factory.deploy(
            ethers.constants.AddressZero,
            SALT1,
            bytecode
        )
        await tx.wait()

        transactionModule = new ethers.Contract(
            transactionModuleAddress,
            TransactionModuleArtifact.abi,
            owner
        )

        console.log('TransactionModule (implementation) is now newly deployed')
        console.log(
            `TransactionModule ${transactionModule.address} constructor()`
        )
    }

    // delopy ModuleProxy (TransactionModule)
    factory = await ethers.getContractFactory('ModuleProxy')
    if (process.env['MODULE_PROXY_TRANSACTION_MODULE']) {
        const ModuleProxyArtifact = await hre.artifacts.readArtifact(
            'ModuleProxy'
        )
        const ModuleProxyABI = ModuleProxyArtifact.abi
        transactionModuleProxy = new ethers.Contract(
            process.env['MODULE_PROXY_TRANSACTION_MODULE'],
            ModuleProxyABI,
            owner
        )
        console.log('ModuleProxy (TransactionModule) has been deployed before')
    } else {
        const ModuleProxyArtifact = await hre.artifacts.readArtifact(
            'ModuleProxy'
        )

        const iface = new ethers.utils.Interface(ModuleProxyArtifact.abi)
        const bytecode =
            ModuleProxyArtifact.bytecode +
            iface.encodeDeploy([owner.address]).slice(2)
        const moduleProxyAddress = await create2Factory.findCreate2Address(
            SALT1,
            ethers.utils.keccak256(bytecode)
        )

        const tx = await create2Factory.deploy(
            ethers.constants.AddressZero,
            SALT1,
            bytecode
        )
        await tx.wait()

        transactionModuleProxy = new ethers.Contract(
            moduleProxyAddress,
            ModuleProxyArtifact.abi,
            owner
        )

        console.log('ModuleProxy (TransactionModule) is now newly deployed')
        console.log(
            `ModuleProxy (TransactionModule) ${transactionModuleProxy.address} constructor()`
        )

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
    }

    // delopy ModuleProxy (SecurityModule)
    factory = await ethers.getContractFactory('ModuleProxy')
    if (process.env['MODULE_PROXY_SECURITY_MODULE']) {
        const ModuleProxyArtifact = await hre.artifacts.readArtifact(
            'ModuleProxy'
        )
        const ModuleProxyABI = ModuleProxyArtifact.abi
        securityModuleProxy = new ethers.Contract(
            process.env['MODULE_PROXY_SECURITY_MODULE'],
            ModuleProxyABI,
            owner
        )
        console.log('ModuleProxy (SecurityModule) has been deployed before')
    } else {
        const ModuleProxyArtifact = await hre.artifacts.readArtifact(
            'ModuleProxy'
        )

        const iface = new ethers.utils.Interface(ModuleProxyArtifact.abi)
        const bytecode =
            ModuleProxyArtifact.bytecode +
            iface.encodeDeploy([owner.address]).slice(2)
        const moduleProxyAddress = await create2Factory.findCreate2Address(
            SALT2,
            ethers.utils.keccak256(bytecode)
        )

        const tx = await create2Factory.deploy(
            ethers.constants.AddressZero,
            SALT2,
            bytecode
        ) // The second ModuleProxy, should use a differentce SALT
        await tx.wait()

        securityModuleProxy = new ethers.Contract(
            moduleProxyAddress,
            ModuleProxyArtifact.abi,
            owner
        )

        console.log('ModuleProxy (securityModule) is now newly deployed')
        console.log(
            `ModuleProxy (securityModule) ${securityModuleProxy.address} constructor()`
        )

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
    }

    // delopy TestToken
    factory = await ethers.getContractFactory('TestToken')
    if (process.env['TEST_TOKEN']) {
        const TestTokenArtifact = await hre.artifacts.readArtifact('TestToken')
        const TestTokenABI = TestTokenArtifact.abi
        testToken = new ethers.Contract(
            process.env['TEST_TOKEN'],
            TestTokenABI,
            owner
        )
        console.log('TestToken has been deployed before')
    } else {
        const TestTokenArtifact = await hre.artifacts.readArtifact('TestToken')

        const iface = new ethers.utils.Interface(TestTokenArtifact.abi)
        const bytecode =
            TestTokenArtifact.bytecode + iface.encodeDeploy([100000]).slice(2)
        const testTokenAddress = await create2Factory.findCreate2Address(
            SALT1,
            ethers.utils.keccak256(bytecode)
        )

        const tx = await create2Factory.deploy(
            ethers.constants.AddressZero,
            SALT1,
            bytecode
        )
        await tx.wait()

        testToken = new ethers.Contract(
            testTokenAddress,
            TestTokenArtifact.abi,
            owner
        )

        console.log('TestToken is now newly deployed')
        console.log(`TestToken ${testToken.address} constructor(100000)`)
    }

    proxiedSecurityModule = new ethers.Contract(
        securityModuleProxy.address,
        SecurityModule.abi,
        owner
    )

    // TODO: Check if newly deployed
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

    // TODO: Check if newly deployed
    await proxiedTransactionModule.initialize(moduleRegistry.address)
    console.log('transaction module', proxiedTransactionModule.address)

    // TODO: Check if newly deployed
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

    // delopy Wallet
    factory = await ethers.getContractFactory('Wallet')
    if (process.env['WALLET']) {
        const WalletArtifact = await hre.artifacts.readArtifact('Wallet')
        const WalletABI = WalletArtifact.abi
        masterWallet = new ethers.Contract(
            process.env['WALLET'],
            WalletABI,
            owner
        )
        console.log('Wallet has been deployed before')
    } else {
        const WalletArtifact = await hre.artifacts.readArtifact('Wallet')

        const iface = new ethers.utils.Interface(WalletArtifact.abi)
        const bytecode =
            WalletArtifact.bytecode + iface.encodeDeploy([]).slice(2)
        const masterWalletAddress = await create2Factory.findCreate2Address(
            SALT1,
            ethers.utils.keccak256(bytecode)
        )

        const tx = await create2Factory.deploy(
            ethers.constants.AddressZero,
            SALT1,
            bytecode
        )
        await tx.wait()

        masterWallet = new ethers.Contract(
            masterWalletAddress,
            WalletArtifact.abi,
            owner
        )

        console.log('Wallet is now newly deployed')
        console.log(`Wallet ${masterWallet.address} constructor()`)
    }

    console.log('unsorted', user1.address, user2.address, user3.address)
    let signers = [user1, user2, user3]
    signers.sort(function (a, b) {
        return a.address - b.address
    })
    user1 = signers[0]
    user2 = signers[1]
    user3 = signers[2]

    console.log('sorted', user1.address, user2.address, user3.address)

    // delopy Proxy
    factory = await ethers.getContractFactory('Proxy')
    if (process.env['PROXY']) {
        const ProxyArtifact = await hre.artifacts.readArtifact('Proxy')
        const ProxyABI = ProxyArtifact.abi
        proxy = new ethers.Contract(process.env['PROXY'], ProxyABI, owner)
        console.log('Proxy has been deployed before')
    } else {
        const ProxyArtifact = await hre.artifacts.readArtifact('Proxy')
        const iface = new ethers.utils.Interface(ProxyArtifact.abi)
        const bytecode =
            ProxyArtifact.bytecode +
            iface.encodeDeploy([masterWallet.address]).slice(2)
        const proxyAddress = await create2Factory.findCreate2Address(
            SALT1,
            ethers.utils.keccak256(bytecode)
        )

        // Proxy is Ownable, should transfer the ownership back to the owner from Create2Factory
        const tx = await create2Factory.deploy(owner.address, SALT1, bytecode)
        await tx.wait()

        proxy = new ethers.Contract(proxyAddress, ProxyArtifact.abi, owner)

        console.log('Proxy is now newly deployed')
        console.log(
            `Proxy ${proxy.address} constructor(${masterWallet.address})`
        )
    }

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
