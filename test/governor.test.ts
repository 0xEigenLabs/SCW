// eslint-disable-next-line @typescript-eslint/no-var-requires
const { waffle, ethers } = require('hardhat')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chai = require('chai')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { solidity } = require('ethereum-waffle')
chai.use(solidity)
const { expect } = chai
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hre = require('hardhat')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const helpers = require('./helpers')

const provider = waffle.provider

let governanceToken
let timelock
let governorAlpha

import { constants } from 'ethers'

const DELAY = 60 * 60 * 24 * 2

describe('GovernorAlpha', () => {
    let wallet
    before(async () => {
        [wallet] = await hre.ethers.getSigners()
    })

    beforeEach(async function () {
        const fixture = await helpers.governanceFixture([wallet], provider)
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
        const quorumVotes = await governorAlpha.quorumVotes()
        expect(quorumVotes).to.be.eq(ethers.utils.parseEther('40000000'))
        const proposalThreshold = await governorAlpha.proposalThreshold()
        expect(proposalThreshold).to.be.eq(ethers.utils.parseEther('10000000'))
    })
})
