// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ethers } = require('hardhat')
import { BigNumber, utils } from 'ethers'
import { Contract, Wallet, providers } from 'ethers'

import chai, { expect } from 'chai'
import { solidity } from 'ethereum-waffle'
const provider = ethers.provider

export const wait = async (ms: number) => {
    setTimeout(function () {
        console.log('Waiting')
    }, ms)
}

export const showBalances = async () => {
    const accounts = provider.accounts
    for (let i = 0; i < accounts.length; i++) {
        console.log(
            accounts[i] +
                ': ' +
                utils.formatEther(provider.getBalance(accounts[i])),
            'ether'
        )
    }
}

export interface Deposited {
    from: string
    value: BigNumber
    data: string
}

export interface Transacted {
    msgSender: string
    otherSigner: string
    operation: string
    toAddress: string
    value: BigNumber
    data: string
}

export const addHexPrefix = function (str: string): string {
    if (typeof str !== 'string') {
        return str
    }

    return str.startsWith('0x') ? str : '0x' + str
}

export const signHash = async (destinationAddr, value, data, nonce) => {
    const input = `0x${[
        '0x19',
        '0x00',
        destinationAddr,
        ethers.utils.hexZeroPad(ethers.utils.hexlify(value), 32),
        data,
        ethers.utils.hexZeroPad(ethers.utils.hexlify(nonce), 32),
    ]
        .map((hex) => hex.slice(2))
        .join('')}`

    return ethers.utils.keccak256(input)
}

export const DOMAIN_TYPEHASH = utils.keccak256(
    utils.toUtf8Bytes(
        'EIP712Domain(string name,uint256 chainId,address verifyingContract)'
    )
)

export const PERMIT_TYPEHASH = utils.keccak256(
    utils.toUtf8Bytes(
        'Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)'
    )
)

export const signHashForGovernanceToken = async (
    token_address,
    chain_id,
    owner,
    spender,
    value,
    nonce,
    deadline
) => {
    const domainSeparator = utils.keccak256(
        utils.defaultAbiCoder.encode(
            ['bytes32', 'bytes32', 'uint256', 'address'],
            [
                DOMAIN_TYPEHASH,
                utils.keccak256(utils.toUtf8Bytes('GovernanceToken')),
                chain_id,
                token_address,
            ]
        )
    )

    const structHash = utils.keccak256(
        utils.defaultAbiCoder.encode(
            ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
            [PERMIT_TYPEHASH, owner, spender, value, nonce, deadline]
        )
    )

    const input = `0x${['0x19', '0x01', domainSeparator, structHash]
        .map((hex) => hex.slice(2))
        .join('')}`

    return ethers.utils.keccak256(input)
}

export async function getSignatures(
    messageHash,
    signers,
    returnBadSignatures = false
) {
    // Sort the signers
    const sortedSigners = signers

    let sigs = '0x'
    for (let index = 0; index < sortedSigners.length; index += 1) {
        const signer = sortedSigners[index]
        let sig = await signer.signMessage(messageHash)

        if (returnBadSignatures) {
            sig += 'a1'
        }

        sig = sig.slice(2)
        sigs += sig
    }
    return sigs
}

export const DELAY = 60 * 60 * 24 * 2

export async function mineBlock(
    provider: providers.Web3Provider,
    timestamp: number
): Promise<void> {
    const { timestamp: now } = await provider.getBlock('latest')

    await provider.send('evm_increaseTime', [timestamp - now])
    return provider.send('evm_mine', [])
}

export function expandTo18Decimals(n: number): BigNumber {
    return BigNumber.from(n).mul(BigNumber.from(10).pow(18))
}

chai.use(solidity)

interface GovernanceFixture {
    governanceToken: Contract
    timelock: Contract
    governorAlpha: Contract
}

export async function governanceFixture(
    [wallet]: Wallet[],
    provider: providers.Web3Provider
): Promise<GovernanceFixture> {
    const { timestamp: now } = await provider.getBlock('latest')
    let transactionCount = await wallet.getTransactionCount()

    const timelockAddress = Contract.getContractAddress({
        from: wallet.address,
        nonce: transactionCount + 1,
    })

    let factory = await ethers.getContractFactory('GovernanceToken')
    console.log('Deploy time: ', now)
    const governanceToken = await factory.deploy(
        wallet.address,
        timelockAddress,
        now + 60 * 60
    )
    await governanceToken.deployed()
    transactionCount = await wallet.getTransactionCount()

    // deploy timelock, controlled by what will be the governor
    const governorAlphaAddress = Contract.getContractAddress({
        from: wallet.address,
        nonce: transactionCount + 1,
    })
    factory = await ethers.getContractFactory('Timelock')
    const timelock = await factory.deploy(governorAlphaAddress, DELAY)
    await timelock.deployed()
    expect(timelock.address).to.be.eq(timelockAddress)

    // deploy governorAlpha
    factory = await ethers.getContractFactory('GovernorAlpha')
    const governorAlpha = await factory.deploy(
        timelock.address,
        governanceToken.address
    )
    await governorAlpha.deployed()
    expect(governorAlpha.address).to.be.eq(governorAlphaAddress)

    return { governanceToken, timelock, governorAlpha }
}

/**
 * Returns the address a contract will have when created from the provided address
 * https://ethereum.stackexchange.com/questions/760/how-is-the-address-of-an-ethereum-contract-computed
 * @param address
 * @return address
 */
exports.getNextContractAddress = async (address: string) => {
    const nonce = await provider.getTransactionCount(address)
    const transaction = {
        from: address,
        nonce: nonce,
    }
    return utils.getContractAddress(transaction)
}

export function toHexString(byteArray) {
    let s = '0x'
    byteArray.forEach(function (byte) {
        s += ('0' + (byte & 0xff).toString(16)).slice(-2)
    })
    return s
}
