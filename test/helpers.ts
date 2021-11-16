const { ethers, waffle } = require("hardhat");
import { BigNumber, utils } from "ethers"

import { WalletSimple__factory } from "../typechain/factories/WalletSimple__factory"
import { EtcWalletSimple__factory } from "../typechain/factories/EtcWalletSimple__factory"
import { AvaxWalletSimple__factory } from "../typechain/factories/AvaxWalletSimple__factory"
import { RskWalletSimple__factory } from "../typechain/factories/RskWalletSimple__factory"

import { WalletSimple } from "../typechain/WalletSimple"
import { EtcWalletSimple } from "../typechain/EtcWalletSimple"
import { AvaxWalletSimple } from "../typechain/AvaxWalletSimple"
import { RskWalletSimple } from "../typechain/RskWalletSimple"
import { Forwarder } from "../typechain/Forwarder"
import { Forwarder__factory } from "../typechain/factories/Forwarder__factory"

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
        case "WalletSimple":
            wallet = await WalletSimple__factory.connect(contract, signer)
            break
        case "EtcWalletSimple":
            wallet = await EtcWalletSimple__factory.connect(contract, signer)
            break
        case "AvaxWalletSimple":
            wallet = await AvaxWalletSimple__factory.connect(contract, signer)
            break
        case "RskWalletSimple":
            wallet = await RskWalletSimple__factory.connect(contract, signer)
            break
    }
    return wallet
}

export const readDepositedLog = async(walletName, contract, signer, receipt) => {

    let wallet = await getWalletInstance(walletName, contract, signer)
    const iface = wallet.interface
    const event = iface.getEvent('Deposited')
    const eventTopic = iface.getEventTopic(event)
    const logs = receipt.logs.filter(log => log.topics[0] === eventTopic)
    return logs.map(
      log => (iface.parseLog(log).args as unknown) as Deposited
    )
}

export interface SafeModeActivated {
    msgSender: string
}

export const readSafeModeActivatedLog = async (walletName, contract, signer, receipt) => {
    let wallet = await getWalletInstance(walletName, contract, signer);
    const iface = wallet.interface
    const event = iface.getEvent("SafeModeActivated")
    const eventTopic = iface.getEventTopic(event)
    const logs = receipt.logs.filter(log => log.topics[0] === eventTopic)
    return logs.map(
        log => (iface.parseLog(log).args as unknown) as SafeModeActivated
    )
}


export interface ForwarderDeposited {
    from: string
    value: BigNumber
    data: string
}

export const readForwarderDepositedLog = async (walletName, contract, signer, receipt) => {
    let wallet = await getWalletInstance(walletName, contract, signer);
    const iface = wallet.interface
    const event = iface.getEvent("ForwarderDeposited")
    const eventTopic = iface.getEventTopic(event)
    const logs = receipt.logs.filter(log => log.topics[0] === eventTopic)
    return logs.map(
        log => (iface.parseLog(log).args as unknown) as ForwarderDeposited
    )
}

export const addHexPrefix = function(str: string): string {
  if (typeof str !== 'string') {
    return str
  }

  return str.startsWith("0x") ? str : '0x' + str
}

export const readTransactedLog= async(walletName, contract, signer, receipt) => {
    let wallet = await getWalletInstance(walletName, contract, signer)
    const iface = wallet.interface
    const event = iface.getEvent('Transacted')
    const eventTopic = iface.getEventTopic(event)
    const logs = receipt.logs.filter(log => log.topics[0] === eventTopic)
    return logs.map(
      log => (iface.parseLog(log).args as unknown) as Transacted
    )
}

// Helper to get sha3 for solidity tightly-packed arguments
export const getSha3ForConfirmationTx = async (prefix, toAddress, amount, data, expireTime, sequenceId) => {
  return utils.arrayify(utils.solidityKeccak256(
    ['string', 'address', 'uint', 'bytes', 'uint', 'uint'],
    [prefix, toAddress, amount, data, expireTime, sequenceId]
  ));
};

// Helper to get token transactions sha3 for solidity tightly-packed arguments
exports.getSha3ForConfirmationTokenTx = function(prefix, toAddress, value, tokenContractAddress, expireTime, sequenceId) {
  return utils.arrayify(utils.solidityKeccak256(
    ['string', 'address', 'uint', 'address', 'uint', 'uint'],
    [prefix, toAddress, value, tokenContractAddress, expireTime, sequenceId]
  ));
};

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
  console.log("nonce", transaction)
  return utils.getContractAddress(transaction)
};

export function toHexString(byteArray) {
  var s = '0x';
  byteArray.forEach(function(byte) {
    s += ('0' + (byte & 0xFF).toString(16)).slice(-2);
  });
  return s;
}

export const createForwarderFromWallet = async (wallet) => {
    const forwarderAddress = await exports.getNextContractAddress(wallet.address);
    let res = await wallet.createForwarder();
    await res.wait()
    return await Forwarder__factory.connect(forwarderAddress, provider)
};
