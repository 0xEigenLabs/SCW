import chai, { expect } from 'chai'
import { Contract, Wallet, providers, BigNumber } from 'ethers'
import { solidity, deployContract } from 'ethereum-waffle'

import GovernanceToken from '../artifacts/contracts/GovernanceToken.sol/GovernanceToken.json'
import Timelock from '../artifacts/contracts/Timelock.sol/Timelock.json'
import GovernorAlpha from '../artifacts/contracts/GovernorAlpha.sol/GovernorAlpha.json'

export const DELAY = 60 * 60 * 24 * 2

export async function mineBlock(
    provider: providers.Web3Provider,
    timestamp: number
): Promise<void> {
    const { timestamp: now } = await provider.getBlock('latest')
    return provider.send('evm_increaseTime', [timestamp - now])
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
    // deploy UNI, sending the total supply to the deployer
    const { timestamp: now } = await provider.getBlock('latest')
    let transactionCount = await wallet.getTransactionCount()

    const timelockAddress = Contract.getContractAddress({
        from: wallet.address,
        nonce: transactionCount + 1,
    })
    const governanceToken = await deployContract(wallet, GovernanceToken, [
        wallet.address,
        timelockAddress,
        now + 60 * 60,
    ])

    transactionCount = await wallet.getTransactionCount()

    // deploy timelock, controlled by what will be the governor
    const governorAlphaAddress = Contract.getContractAddress({
        from: wallet.address,
        nonce: transactionCount + 1,
    })
    const timelock = await deployContract(wallet, Timelock, [
        governorAlphaAddress,
        DELAY,
    ])
    expect(timelock.address).to.be.eq(timelockAddress)

    // deploy governorAlpha
    const governorAlpha = await deployContract(wallet, GovernorAlpha, [
        timelock.address,
        governanceToken.address,
    ])
    expect(governorAlpha.address).to.be.eq(governorAlphaAddress)

    return { governanceToken, timelock, governorAlpha }
}
