const { waffle, ethers } = require('hardhat')
import { Wallet, utils, BigNumber, providers, Transaction } from 'ethers'

const chai = require('chai')
const { solidity } = require('ethereum-waffle')
chai.use(solidity)
const { expect } = chai
const hre = require('hardhat')

const { getContractAddress } = require('@ethersproject/address')

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

describe('GovernorAlpha', () => {
    let wallet: Wallet
    beforeEach(async function () {
        wallet = await ethers.getSigner()
        const { timestamp: now } = await provider.getBlock('latest')
        let transactionCount = await wallet.getTransactionCount()
        console.log('Current transaction count:', transactionCount)
        const timelockAddress = Contract.getContractAddress({
            from: wallet.address,
            nonce: transactionCount + 1,
        })
        console.log('Expect Timelock address:', timelockAddress)
        let factory = await ethers.getContractFactory('GovernanceToken')
        governanceToken = await factory.deploy(
            wallet.address,
            timelockAddress,
            now + 60 * 60
        )
        console.log('GovernanceToken address:', governanceToken.address)

        transactionCount = await wallet.getTransactionCount()

        const governorAlphaAddress = Contract.getContractAddress({
            from: wallet.address,
            nonce: transactionCount + 1,
        })

        factory = await ethers.getContractFactory('Timelock')
        timelock = await factory.deploy(governorAlphaAddress, DELAY)
        await timelock.deployed()
        console.log('Actual Timelock address:', timelock.address)
        expect(timelock.address).to.be.eq(timelockAddress)

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
        const testTokenFromGovernor = await governorAlpha.eigen()
        expect(testTokenFromGovernor).to.be.eq(governanceToken.address)
    })
})
