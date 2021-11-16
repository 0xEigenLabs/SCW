const { waffle, ethers } = require("hardhat");
import { Wallet, utils, BigNumber, providers } from "ethers"

const helpers = require('./helpers');
import { expect } from "chai"
import { Forwarder__factory } from "../typechain/factories/Forwarder__factory"
import { Forwarder } from "../typechain/Forwarder"

const provider = waffle.provider

describe('Forwarder', () => {
  let accounts
  let forwarderContract: Forwarder
  let forwarderFactory
  const gasPrice = 20000
  let signers
  const depositedToAccmount1 = utils.parseEther("5");
  beforeEach(async function() {
      accounts = await provider.listAccounts()
      signers = await ethers.getSigners()
      console.log(accounts)
  });

  it('Basic forwarding test', async function () {
    forwarderFactory = await ethers.getContractFactory("Forwarder", signers);
    forwarderContract = await forwarderFactory.deploy();
    await forwarderContract.deployed();
    console.log("deployed address", forwarderContract.address)
    let resp = await signers[0].sendTransaction({to: accounts[1], value: depositedToAccmount1})
    let rec = await resp.wait()
    expect(rec.status).eq(1)
    const account0StartEther = await provider.getBalance(accounts[0]);
    const amount = utils.parseEther("0.001")
    resp = await signers[1].sendTransaction(
        {
            to: forwarderContract.address,
            value: amount
        }
    );
    rec = await resp.wait()
    expect(rec.status).eq(1)
    const gasUsed = rec.gasUsed

    let total = amount.add(utils.parseUnits(gasUsed.toString(), "gwei"))
    const account0EndEther = (await provider.getBalance(accounts[0]));
    expect(account0EndEther).eq(account0StartEther.add(total));
  });

  it('Flush', async function() {
    const amount = utils.parseEther("0.5")
    let res = await signers[0].sendTransaction({to: accounts[1], value: amount});
    let rec = await res.wait()
    expect(rec.status).eq(1)
    // determine the forwarder contract address
    const forwarderContractAddress = await helpers.getNextContractAddress(signers[0].address);
    console.log("new contract address", accounts[0], signers[0].address, forwarderContractAddress)

    const account0StartEther = await provider.getBalance(accounts[0]);

    // send funds to the contract address first
    console.log("account 1 balance", (await provider.getBalance(accounts[1])).toString())
    res = await signers[1].sendTransaction({to: forwarderContractAddress, value: amount });
    rec = await res.wait()
    console.log("gas used", rec.gasUsed);
    const gasUsed = utils.parseUnits(rec.gasUsed.toString(), 'gwei')
    expect(rec.status).eq(1)
    // Check that the ether is in the forwarder address and not yet in account 0
    expect(await provider.getBalance(forwarderContractAddress)).eq(amount);
    expect(await provider.getBalance(accounts[0])).eq(account0StartEther.add(gasUsed));

    forwarderFactory = await ethers.getContractFactory("Forwarder", signers);
    forwarderContract = await forwarderFactory.deploy();
    await forwarderContract.deployed();
    console.log("deployed address", forwarderContract.address)

    expect(forwarderContract.address).to.equal(forwarderContractAddress);
    // Check that the ether is still in the forwarder address and not yet in account 0
    res = await forwarderContract.flush.call(undefined, { from: accounts[0], gasPrice: gasPrice});
    rec = await res.wait()
    expect(rec.status).eq(1)
    console.log("forwarder", await provider.getBalance(forwarderContract.address))
    expect(await provider.getBalance(accounts[0])).eq(account0StartEther.add(amount.add(gasUsed)));
  });
});
