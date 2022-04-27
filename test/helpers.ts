const { ethers, waffle } = require("hardhat");
import { BigNumber, utils } from "ethers"

import { Wallet__factory } from "../typechain/factories/Wallet__factory"

const provider = ethers.provider;

export const wait = async (ms: number) => {
    setTimeout(function() { console.log("Waiting") }, ms);
}

export const showBalances = async () => {
    const accounts = provider.accounts;
    for (let i=0; i<accounts.length; i++) {
        console.log(accounts[i] + ': ' + utils.formatEther(provider.getBalance(accounts[i])), 'ether' );
    }
};

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

async function getWalletInstance(walletName, contract, signer) {
    let wallet
    switch (walletName) {
        case "Wallet":
            wallet = await Wallet__factory.connect(contract, signer)
        break
    }
    return wallet
}

export const addHexPrefix = function(str: string): string {
    if (typeof str !== 'string') {
        return str
    }

    return str.startsWith("0x") ? str : '0x' + str
}

export const signHash = async (destinationAddr, value, data, nonce) => {
    const input = `0x${[
        "0x19",
        "0x00",
        destinationAddr,
        ethers.utils.hexZeroPad(ethers.utils.hexlify(value), 32),
        data,
        ethers.utils.hexZeroPad(ethers.utils.hexlify(nonce), 32),
    ].map((hex) => hex.slice(2)).join("")}`;

    return ethers.utils.keccak256(input);
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

export async function getSignatures(messageHash, signers, returnBadSignatures = false) {
    // Sort the signers
    let sortedSigners = signers;

    let sigs = "0x";
    for (let index = 0; index < sortedSigners.length; index += 1) {
        const signer = sortedSigners[index];
        let sig = await signer.signMessage(messageHash);

        if (returnBadSignatures) {
            sig += "a1";
        }

        sig = sig.slice(2);
        sigs += sig;
    }
    return sigs;
}

/**
 * Returns the address a contract will have when created from the provided address
 * https://ethereum.stackexchange.com/questions/760/how-is-the-address-of-an-ethereum-contract-computed
 * @param address
 * @return address
 */
exports.getNextContractAddress = async (address: string) => {
    const nonce = await provider.getTransactionCount(address);
    let transaction = {
        from: address,
        nonce: nonce
    };
    return utils.getContractAddress(transaction)
};

export function toHexString(byteArray) {
    var s = '0x';
    byteArray.forEach(function(byte) {
        s += ('0' + (byte & 0xFF).toString(16)).slice(-2);
    });
    return s;
}
