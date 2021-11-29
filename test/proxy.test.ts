const { waffle, ethers } = require("hardhat");
import { Wallet, utils, BigNumber, providers } from "ethers"

import { Wallet__factory } from "../typechain/factories/Wallet__factory"

import { expect } from "chai"

const salts = [utils.formatBytes32String('1'), utils.formatBytes32String('2')]

const provider = waffle.provider

const getGas = async (tx) => {
  const receipt = await ethers.provider.getTransactionReceipt(tx.hash)
  return receipt.gasUsed.toString()
}

describe('Wallet Factory Test', () => {
  const gasPrice = 20000
  let wallet
  let proxy
  let walletStandaloneGas
  let walletProxyGas

  let owner
  let accounts
  const modules = [ Wallet.createRandom().address ]
  before(async function() {
    [owner] = await ethers.getSigners();
    accounts = await provider.listAccounts()
  })
  it("Should deploy master wallet contract", async function () {
    wallet = await (await ethers.getContractFactory("Wallet")).deploy();
    await wallet.deployed()
    walletStandaloneGas = await getGas(wallet.deployTransaction)
    expect(wallet.address).to.exist;
  });

  it("Should deploy proxy contract", async function () {
    proxy = await (await ethers.getContractFactory("Proxy")).deploy(wallet.address);
    expect(proxy.address).to.exist;
  });


  it("Should deploy a cloned wallet contract and allow initialization of custom wallet info", async function () {
    // Get the expected address
    const walletAddress = await proxy.getAddress(salts[0]);
    expect(walletAddress).to.exist;

    const tx = await proxy.create(salts[0]);
    await tx.wait()
    walletProxyGas = await getGas(tx)

    const wallet1 = Wallet__factory.connect(walletAddress, owner)
    expect(wallet1.address).to.equal(walletAddress)

    let initTx = await wallet1.initialize([accounts[1], accounts[2], accounts[3]], modules, {
        gasLimit: 210000, gasPrice: 10
    });
    await initTx.wait()

    await expect(wallet1.initialize([accounts[1], accounts[2], accounts[3]], modules)).to.be.revertedWith(
      "contract is already initialized"
    )

    expect(await wallet1.signers(0)).to.equal(accounts[1])
    expect(await wallet1.signers(1)).to.equal(accounts[2])
  });

  it("Minimal Proxy deployment should cost 10x less than a standard deployment", async function () {
    expect(Number(walletStandaloneGas)).to.be.greaterThan(Number(walletProxyGas)*10)
  });
});
