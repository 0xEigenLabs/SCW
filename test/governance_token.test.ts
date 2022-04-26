import chai, { expect } from 'chai'
import { BigNumber, Contract, constants, utils, providers } from 'ethers'
const { waffle, ethers } = require('hardhat')
import {
    solidity,
    MockProvider,
    createFixtureLoader,
    deployContract,
} from 'ethereum-waffle'
import { ecsign } from 'ethereumjs-util'

const hre = require('hardhat')

import { governanceFixture } from './fixtures'
import GovernanceToken from '../artifacts/contracts/GovernanceToken.sol/GovernanceToken.json'

chai.use(solidity)

const DOMAIN_TYPEHASH = utils.keccak256(
    utils.toUtf8Bytes(
        'EIP712Domain(string name,uint256 chainId,address verifyingContract)'
    )
)

const PERMIT_TYPEHASH = utils.keccak256(
    utils.toUtf8Bytes(
        'Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)'
    )
)

const provider = waffle.provider

async function mineBlock(
    provider: providers.Web3Provider,
    timestamp: number
): Promise<void> {
    return provider.send('evm_mine', [timestamp])
}

function expandTo18Decimals(n: number): BigNumber {
    return BigNumber.from(n).mul(BigNumber.from(10).pow(18))
}

describe('Governance Token', () => {
    let governanceToken: Contract

    let wallet
    let other0
    let other1
    let loadFixture
    before(async () => {
        ;[wallet, other0, other1] = await hre.ethers.getSigners()
        loadFixture = createFixtureLoader([wallet], provider)
    })

    beforeEach(async function () {
        const fixture = await loadFixture(governanceFixture)
        governanceToken = fixture.governanceToken
    })

    it('permit', async () => {
        const domainSeparator = utils.keccak256(
            utils.defaultAbiCoder.encode(
                ['bytes32', 'bytes32', 'uint256', 'address'],
                [
                    DOMAIN_TYPEHASH,
                    utils.keccak256(utils.toUtf8Bytes('GovernanceToken')),
                    1,
                    governanceToken.address,
                ]
            )
        )

        const owner = wallet.address
        const spender = other0.address
        const value = 123
        const nonce = await governanceToken.nonces(wallet.address)
        const deadline = constants.MaxUint256
        const digest = utils.keccak256(
            utils.solidityPack(
                ['bytes1', 'bytes1', 'bytes32', 'bytes32'],
                [
                    '0x19',
                    '0x01',
                    domainSeparator,
                    utils.keccak256(
                        utils.defaultAbiCoder.encode(
                            [
                                'bytes32',
                                'address',
                                'address',
                                'uint256',
                                'uint256',
                                'uint256',
                            ],
                            [
                                PERMIT_TYPEHASH,
                                owner,
                                spender,
                                value,
                                nonce,
                                deadline,
                            ]
                        )
                    ),
                ]
            )
        )

        // const { v, r, s } = ecsign(
        //     Buffer.from(digest.slice(2), 'hex'),
        //     Buffer.from(wallet.privateKey.slice(2), 'hex')
        // )

        // Sign the string message
        console.log('digest: ', digest)

        let flatSig = await wallet.signMessage(ethers.utils.arrayify(digest))

        console.log('flatSig: ', flatSig)

        // For Solidity, we need the expanded-format of a signature
        let sig = ethers.utils.splitSignature(flatSig)

        console.log('v: ', sig.v)
        console.log('r: ', sig.r)
        console.log('s: ', sig.s)

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
        await governanceToken.transfer(other0.address, expandTo18Decimals(1))
        await governanceToken.transfer(other1.address, expandTo18Decimals(2))

        let currectVotes0 = await governanceToken.getCurrentVotes(
            other0.address
        )
        let currectVotes1 = await governanceToken.getCurrentVotes(
            other1.address
        )
        expect(currectVotes0).to.be.eq(0)
        expect(currectVotes1).to.be.eq(0)

        await governanceToken.connect(other0).delegate(other1.address)
        currectVotes1 = await governanceToken.getCurrentVotes(other1.address)
        expect(currectVotes1).to.be.eq(expandTo18Decimals(1))

        await governanceToken.connect(other1).delegate(other1.address)
        currectVotes1 = await governanceToken.getCurrentVotes(other1.address)
        expect(currectVotes1).to.be.eq(
            expandTo18Decimals(1).add(expandTo18Decimals(2))
        )

        await governanceToken.connect(other1).delegate(wallet.address)
        currectVotes1 = await governanceToken.getCurrentVotes(other1.address)
        expect(currectVotes1).to.be.eq(expandTo18Decimals(1))
    })

    it('mints', async () => {
        const { timestamp: now } = await provider.getBlock('latest')
        const governanceToken = await deployContract(wallet, GovernanceToken, [
            wallet.address,
            wallet.address,
            now + 60 * 60,
        ])
        const supply = await governanceToken.totalSupply()

        await expect(
            governanceToken.mint(wallet.address, 1)
        ).to.be.revertedWith('GovernanceToken::mint: minting not allowed yet')

        let timestamp = await governanceToken.mintingAllowedAfter()
        await mineBlock(provider, timestamp.toString())

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
        const mintCap = BigNumber.from(await governanceToken.mintCap())
        const amount = supply.mul(mintCap).div(100)
        await governanceToken.mint(wallet.address, amount)
        expect(await governanceToken.balanceOf(wallet.address)).to.be.eq(
            supply.add(amount)
        )

        timestamp = await governanceToken.mintingAllowedAfter()
        await mineBlock(provider, timestamp.toString())
        // cannot mint 2.01%
        await expect(
            governanceToken.mint(wallet.address, supply.mul(mintCap.add(1)))
        ).to.be.revertedWith('GovernanceToken::mint: exceeded mint cap')
    })
})
