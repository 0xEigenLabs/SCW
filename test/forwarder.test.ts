const { waffle, ethers } = require("hardhat");
import { Wallet, utils, BigNumber, providers } from "ethers"

const helpers = require('./helpers');
import { expect } from "chai"
import { Forwarder__factory } from "../typechain/factories/Forwarder__factory"
import { Forwarder } from "../typechain/Forwarder"

const provider = waffle.provider

describe('Forwarder', () => {
  let forwarderContract: Forwarder
  let forwarderFactory
  const gasPrice = 20000
  let user1, owner
  const depositedToAccmount1 = utils.parseEther("5");
  before(async function() {
      owner = await ethers.getSigner()
      user1 = Wallet.createRandom().connect(provider)
  });

  it('Basic forwarding test', async function () {
    forwarderFactory = await ethers.getContractFactory("Forwarder", provider);
    forwarderContract = await forwarderFactory.deploy();
    await forwarderContract.deployed();
    console.log("deployed address", forwarderContract.address)
    let resp = await owner.sendTransaction({to: user1.address, value: depositedToAccmount1})
    let rec = await resp.wait()
    expect(rec.status).eq(1)
    const account0StartEther = await provider.getBalance(owner.address);
    const amount = utils.parseEther("0.001")
    resp = await user1.sendTransaction(
        {
            to: forwarderContract.address,
            value: amount
        }
    );
    rec = await resp.wait()
    expect(rec.status).eq(1)
    const gasUsed = rec.gasUsed

    let total = amount.add(utils.parseUnits(gasUsed.toString(), "gwei"))
    const account0EndEther = (await provider.getBalance(owner.address));
    expect(account0EndEther).eq(account0StartEther.add(total));
  });

  it('Flush', async function() {
    const amount = utils.parseEther("0.5")
    let res = await owner.sendTransaction({to: user1.address, value: amount});
    let rec = await res.wait()
    expect(rec.status).eq(1)
    // determine the forwarder contract address
    const forwarderContractAddress = await helpers.getNextContractAddress(owner.address);
    console.log("new contract address", owner.address, owner.address, forwarderContractAddress)

    const account0StartEther = await provider.getBalance(owner.address);

    // send funds to the contract address first
    console.log("account 1 balance", (await provider.getBalance(user1.address)).toString())
    res = await user1.sendTransaction({to: forwarderContractAddress, value: amount });
    rec = await res.wait()
    console.log("gas used", rec.gasUsed);
    const gasUsed = utils.parseUnits(rec.gasUsed.toString(), 'gwei')
    expect(rec.status).eq(1)
    // Check that the ether is in the forwarder address and not yet in account 0
    expect(await provider.getBalance(forwarderContractAddress)).eq(amount);
    expect(await provider.getBalance(owner.address)).eq(account0StartEther.add(gasUsed));

    forwarderFactory = await ethers.getContractFactory("Forwarder", provider);
    forwarderContract = await forwarderFactory.deploy();
    await forwarderContract.deployed();
    console.log("deployed address", forwarderContract.address)

    expect(forwarderContract.address).to.equal(forwarderContractAddress);
    // Check that the ether is still in the forwarder address and not yet in account 0
    res = await forwarderContract.flush.call(undefined, { from: owner.address, gasPrice: gasPrice});
    rec = await res.wait()
    expect(rec.status).eq(1)
    console.log("forwarder", await provider.getBalance(forwarderContract.address))
    expect(await provider.getBalance(owner.address)).eq(account0StartEther.add(amount.add(gasUsed)));
  });
});
