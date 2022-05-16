import { ethers } from "hardhat";
import { Wallet, utils } from "ethers"

import { Wallet__factory } from "../typechain/factories/Wallet__factory"

import { expect } from "chai"

const getGas = async (tx) => {
  const receipt = await ethers.provider.getTransactionReceipt(tx.hash)
  return receipt.gasUsed.toString()
}

describe('Wallet Factory Test', () => {
  let wallet
  let proxy
  let walletStandaloneGas
  let walletProxyGas
  let sm

  let owner
  let signers

  before(async function () {
    [owner] = await ethers.getSigners();
    signers = [Wallet.createRandom().address, Wallet.createRandom().address]
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
    const salt = utils.formatBytes32String(utils.sha256(utils.randomBytes(32)).substr(2, 31))
    const walletAddress = await proxy.getAddress(salt);
    expect(walletAddress).to.exist;

    const tx = await proxy.create(salt);
    await tx.wait()
    walletProxyGas = await getGas(tx)

    const wallet1 = Wallet__factory.connect(walletAddress, owner)
    expect(wallet1.address).to.equal(walletAddress)
    console.log("wallet 1 address", wallet1.address)


    const encoder = ethers.utils.defaultAbiCoder
    const data = encoder.encode(["address[]"], [signers])

    let factory = await ethers.getContractFactory("ModuleRegistry")
    const registry = await factory.deploy()
    await registry.deployed()

    factory = await ethers.getContractFactory("SecurityModule")
    sm = await factory.deploy()
    await sm.deployed()
    await sm.initialize(registry.address, 120, 120)

    const initTx = await wallet1.initialize([sm.address], [data]);
    await initTx.wait()
    expect(await wallet1.authorised(sm.address)).to.equal(true)

    await expect(wallet1.initialize([sm.address], [data])).to.be.revertedWith(
      "contract is already initialized"
    )

    expect(await wallet1.owner()).to.equal(owner.address)
  });

  it("Minimal Proxy deployment should cost 10x less than a standard deployment", async function () {
    expect(Number(walletStandaloneGas)).to.be.greaterThan(Number(walletProxyGas) * 10)
  });
});
