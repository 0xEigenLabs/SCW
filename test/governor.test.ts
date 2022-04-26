const { waffle, ethers } = require('hardhat')
import { Wallet, utils, BigNumber, providers, Transaction } from 'ethers'

const chai = require('chai')
const {
    solidity,
    MockProvider,
    createFixtureLoader,
} = require('ethereum-waffle')
chai.use(solidity)
const { expect } = chai
const hre = require('hardhat')

const { getContractAddress } = require('@ethersproject/address')

const helpers = require('./helpers')

const provider = waffle.provider

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

import { governanceFixture } from './fixtures'

const DELAY = 60 * 60 * 24 * 2
let lockPeriod = 5 //s
let recoveryPeriod = 120 //s
let expireTime = Math.floor(new Date().getTime() / 1000) + 1800 // 60 seconds
const delay = (ms) => new Promise((res) => setTimeout(res, ms))

describe('GovernorAlpha', () => {
    // const provider = new MockProvider({
    //     ganacheOptions: {
    //         hardfork: 'istanbul',
    //         mnemonic:
    //             'horn horn horn horn horn horn horn horn horn horn horn horn',
    //         gasLimit: 9999999,
    //     },
    // })
    let wallet

    let loadFixture
    before(async () => {
        ;[wallet] = await hre.ethers.getSigners()
        loadFixture = createFixtureLoader([wallet], provider)
    })

    beforeEach(async function () {
        const fixture = await loadFixture(governanceFixture)
        governanceToken = fixture.governanceToken
        timelock = fixture.timelock
        governorAlpha = fixture.governorAlpha
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
