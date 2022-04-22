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
import { GovernorAlpha__factory } from '../typechain/factories/GovernorAlpha__factory'

const helpers = require('./helpers')

const provider = waffle.provider

let moduleRegistry
let transactionModule
let securityModule
let testToken
let masterWallet
let governancerWallet
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

const UMABI = [
    'function addModuleProxies(string[] memory,address[] memory)',
    'function deploy(string memory, address)',
]

import { Contract, constants } from 'ethers'

const DELAY = 60 * 60 * 24 * 2
let lockPeriod = 5 //s
let recoveryPeriod = 120 //s
let expireTime = Math.floor(new Date().getTime() / 1000) + 1800 // 60 seconds
const delay = (ms) => new Promise((res) => setTimeout(res, ms))

describe('GovernorAlpha', async () => {
    const wallet = await ethers.getSigner()

    let testToken: Contract
    let timelock: Contract
    let governorAlpha: Contract
    beforeEach(async () => {
        let factory = await ethers.getContractFactory('TestToken')
        testToken = await factory.deploy()
        await moduleRegistry.deployed()

        factory = await ethers.getContractFactory('TimeLock')
        timelock = await factory.deploy()
        await moduleRegistry.deployed()

        factory = await ethers.getContractFactory('GovernorAlpha')
        governorAlpha = await factory.deploy()
        await moduleRegistry.deployed()
    })

    it('testToken', async () => {
        const balance = await testToken.balanceOf(wallet.address)
        const totalSupply = await testToken.totalSupply()
        expect(balance).to.be.eq(totalSupply)
    })

    it('timelock', async () => {
        const admin = await timelock.admin()
        expect(admin).to.be.eq(governorAlpha.address)
        const pendingAdmin = await timelock.pendingAdmin()
        expect(pendingAdmin).to.be.eq(constants.AddressZero)
        const delay = await timelock.delay()
        expect(delay).to.be.eq(DELAY)
    })

    it('governor', async () => {
        const votingPeriod = await governorAlpha.votingPeriod()
        expect(votingPeriod).to.be.eq(40320)
        const timelockAddress = await governorAlpha.timelock()
        expect(timelockAddress).to.be.eq(timelock.address)
        const testTokenFromGovernor = await governorAlpha.testToken()
        expect(testTokenFromGovernor).to.be.eq(testToken.address)
    })
})
