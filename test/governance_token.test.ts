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

import chai, { expect } from 'chai'
import { BigNumber, Contract, constants } from 'ethers'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { waffle, ethers } = require('hardhat')
import { solidity } from 'ethereum-waffle'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hre = require('hardhat')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const helpers = require('./helpers')

chai.use(solidity)

const provider = waffle.provider

describe('Governance Token', () => {
    let governanceToken: Contract

    let wallet
    let other0
    let other1
    before(async () => {
        [wallet, other0, other1] = await hre.ethers.getSigners()
    })

    beforeEach(async function () {
        const fixture = await helpers.governanceFixture([wallet], provider)
        governanceToken = fixture.governanceToken
    })

    it('permit', async () => {
        const owner = wallet.address
        const spender = other0.address
        const value = 123
        const nonce = await governanceToken.nonces(wallet.address)
        const deadline = constants.MaxUint256
        const network = await provider.getNetwork()
        const chain_id = network.chainId

        // Sign the string message
        const digest = await helpers.signHashForGovernanceToken(
            governanceToken.address,
            chain_id,
            owner,
            spender,
            value,
            nonce,
            deadline
        )

        const flatSig = await helpers.getSignatures(
            ethers.utils.arrayify(digest),
            [wallet]
        )

        // For Solidity, we need the expanded-format of a signature
        const sig = ethers.utils.splitSignature(flatSig)

        await governanceToken.permit(
            owner,
            spender,
            value,
            deadline,
            sig.v,
            sig.r,
            sig.s
        )

        expect(await governanceToken.allowance(owner, spender)).to.eq(value)
        expect(await governanceToken.nonces(owner)).to.eq(1)

        await governanceToken
            .connect(other0)
            .transferFrom(owner, spender, value)
    })

    it('nested delegation', async () => {
        await governanceToken.transfer(
            other0.address,
            ethers.utils.parseEther('1')
        )
        await governanceToken.transfer(
            other1.address,
            ethers.utils.parseEther('2')
        )

        let currectVotes0 = await governanceToken.getCurrentVotes(
            other0.address
        )
        let currectVotes1 = await governanceToken.getCurrentVotes(
            other1.address
        )

        // No delegation happens, so the current votes are 0
        expect(currectVotes0).to.be.eq(0)
        expect(currectVotes1).to.be.eq(0)

        const time_before_delegate_0_1 = await provider.getBlockNumber()

        // ------------- Delegate: other0 -> other1 ------------------
        await governanceToken.connect(other0).delegate(other1.address)
        currectVotes0 = await governanceToken.getCurrentVotes(other0.address)
        expect(currectVotes0).to.be.eq(ethers.utils.parseEther('0'))
        currectVotes1 = await governanceToken.getCurrentVotes(other1.address)
        expect(currectVotes1).to.be.eq(ethers.utils.parseEther('1'))

        let priorVotes0 = await governanceToken.getPriorVotes(
            other0.address,
            time_before_delegate_0_1
        )
        expect(priorVotes0).to.be.eq(ethers.utils.parseEther('0'))
        let priorVotes1 = await governanceToken.getPriorVotes(
            other1.address,
            time_before_delegate_0_1
        )
        expect(priorVotes1).to.be.eq(ethers.utils.parseEther('0'))
        // ------------------------------------------------------------

        const time_before_delegate_1_1 = await provider.getBlockNumber()

        // ------- Delegate: other1 -> other1 (self delegation) -------
        await governanceToken.connect(other1).delegate(other1.address)
        currectVotes0 = await governanceToken.getCurrentVotes(other0.address)
        expect(currectVotes0).to.be.eq(ethers.utils.parseEther('0'))
        currectVotes1 = await governanceToken.getCurrentVotes(other1.address)
        expect(currectVotes1).to.be.eq(
            ethers.utils.parseEther('1').add(ethers.utils.parseEther('2'))
        )

        priorVotes0 = await governanceToken.getPriorVotes(
            other0.address,
            time_before_delegate_1_1
        )
        expect(priorVotes0).to.be.eq(ethers.utils.parseEther('0'))
        priorVotes1 = await governanceToken.getPriorVotes(
            other1.address,
            time_before_delegate_1_1
        )
        expect(priorVotes1).to.be.eq(ethers.utils.parseEther('1'))
        // ------------------------------------------------------------

        const time_before_delegate_1_owner = await provider.getBlockNumber()

        // Delegate: other1 -> owner, the current votes for other1 are from other0
        await governanceToken.connect(other1).delegate(wallet.address)
        currectVotes0 = await governanceToken.getCurrentVotes(other0.address)
        expect(currectVotes0).to.be.eq(ethers.utils.parseEther('0'))
        currectVotes1 = await governanceToken.getCurrentVotes(other1.address)
        expect(currectVotes1).to.be.eq(ethers.utils.parseEther('1'))

        priorVotes0 = await governanceToken.getPriorVotes(
            other0.address,
            time_before_delegate_1_owner
        )
        expect(priorVotes0).to.be.eq(ethers.utils.parseEther('0'))
        priorVotes1 = await governanceToken.getPriorVotes(
            other1.address,
            time_before_delegate_1_owner
        )
        expect(priorVotes1).to.be.eq(
            ethers.utils.parseEther('1').add(ethers.utils.parseEther('2'))
        )
        // ------------------------------------------------------------

        const time_before_transfer = await provider.getBlockNumber()

        // If other0 receive more, the current new votes still delegated to other1
        await governanceToken.transfer(
            other0.address,
            ethers.utils.parseEther('3')
        )
        currectVotes0 = await governanceToken.getCurrentVotes(other0.address)
        expect(currectVotes0).to.be.eq(ethers.utils.parseEther('0'))
        currectVotes1 = await governanceToken.getCurrentVotes(other1.address)
        expect(currectVotes1).to.be.eq(
            ethers.utils.parseEther('1').add(ethers.utils.parseEther('3'))
        )

        priorVotes0 = await governanceToken.getPriorVotes(
            other0.address,
            time_before_transfer
        )
        expect(priorVotes0).to.be.eq(ethers.utils.parseEther('0'))
        priorVotes1 = await governanceToken.getPriorVotes(
            other1.address,
            time_before_transfer
        )
        expect(priorVotes1).to.be.eq(ethers.utils.parseEther('1'))
        // ------------------------------------------------------------
    })

    it('mints', async () => {
        const { timestamp: now } = await provider.getBlock('latest')
        console.log('Now is: ', now)
        const factory = await ethers.getContractFactory('GovernanceToken')
        const governanceToken = await factory.deploy(
            wallet.address,
            wallet.address,
            now + 60 * 60
        )
        await governanceToken.deployed()

        const supply = await governanceToken.totalSupply()

        await expect(
            governanceToken.mint(wallet.address, 1)
        ).to.be.revertedWith('GovernanceToken::mint: minting not allowed yet')

        let timestamp = await governanceToken.mintingAllowedAfter()
        await helpers.mineBlock(provider, timestamp.toNumber())
        const { timestamp: now1 } = await provider.getBlock('latest')
        console.log('After 1st mine, Now is: ', now1)

        await expect(
            governanceToken.connect(other1).mint(other1.address, 1)
        ).to.be.revertedWith('GovernanceToken::mint: only the minter can mint')
        await expect(
            governanceToken.mint(
                '0x0000000000000000000000000000000000000000',
                1
            )
        ).to.be.revertedWith(
            'GovernanceToken::mint: cannot transfer to the zero address'
        )

        // can mint up to 2%
        const mintCap = BigNumber.from(await governanceToken.MINT_CAP())
        const amount = supply.mul(mintCap).div(100)
        await governanceToken.mint(wallet.address, amount)
        expect(await governanceToken.balanceOf(wallet.address)).to.be.eq(
            supply.add(amount)
        )

        timestamp = await governanceToken.mintingAllowedAfter()
        await helpers.mineBlock(provider, timestamp.toNumber())
        const { timestamp: now2 } = await provider.getBlock('latest')
        console.log('After 2nd mine, Now is: ', now2)
        // cannot mint 2.01%
        await expect(
            governanceToken.mint(wallet.address, supply.mul(mintCap.add(1)))
        ).to.be.revertedWith('GovernanceToken::mint: exceeded mint cap')
    })
})
