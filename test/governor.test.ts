const { waffle, ethers } = require('hardhat')
import { Wallet, utils, BigNumber, providers, Transaction } from 'ethers'

const chai = require('chai')
const { solidity } = require('ethereum-waffle')
chai.use(solidity)
const { expect } = chai
const hre = require('hardhat')

const helpers = require('./helpers')

const provider = waffle.provider

let securityModule
let governanceToken
let timelock
let governorAlpha

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
    const [wallet] = await ethers.getSigners()

    beforeEach(async function () {
        const { timestamp: now } = await provider.getBlock('latest')
        let factory = await ethers.getContractFactory('Timelock')
        timelock = await factory.deploy()
        await timelock.deployed()

        factory = await ethers.getContractFactory('GovernanceToken')
        governanceToken = await factory.deploy(
            wallet.address,
            timelock.address,
            now + 60 * 60
        )
        await governanceToken.deployed()

        factory = await ethers.getContractFactory('GovernorAlpha')
        governorAlpha = await factory.deploy(
            timelock.address,
            governanceToken.address
        )
        await governorAlpha.deployed()
    })

    it('governanceToken', async () => {
        const balance = await governanceToken.balanceOf(wallet.address)
        const totalSupply = await governanceToken.totalSupply()
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
        expect(testTokenFromGovernor).to.be.eq(governanceToken.address)
    })
})
