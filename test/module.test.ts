const {waffle, ethers} = require("hardhat");
import { Wallet, utils, BigNumber, providers } from "ethers";
import { expect } from "chai"

import { ModuleRegistry } from "../typechain/ModuleRegistry"
import { ModuleRegistry__factory } from "../typechain/factories/ModuleRegistry__factory"
import { Wallet__factory } from "../typechain/factories/Wallet__factory" 

const helpers = require("./helpers");
const overrides = { gasLimit: 2100000, gasPrice: 10 }

const provider = waffle.provider

let moduleRegistry
let securityModule
let masterWallet
let owner
let user1
let user2
let user3

describe.only("Module Registry", () => {
    const salts = [utils.formatBytes32String('1'), utils.formatBytes32String('2')]
    before(async () => {
        let factory = await ethers.getContractFactory("ModuleRegistry");
        moduleRegistry = await factory.deploy()
        await moduleRegistry.deployed()
        factory = await ethers.getContractFactory("SecurityModule");
        securityModule = await factory.deploy(moduleRegistry.address)
        await securityModule.deployed()

        //register the module
        let res = await moduleRegistry.registerModule(
            securityModule.address,
            ethers.utils.formatBytes32String("SM")
        );
        await res.wait()

        factory= await ethers.getContractFactory("Wallet")
        masterWallet = await factory.deploy()
        await masterWallet.deployed()

        // FIXME
        let signers = await ethers.getSigners()
        owner = signers[0]
        user1= signers[1]
        user2 = signers[2]
        user3 = signers[3]
    })

    it("Deploy module", async function() {
        let walletFactory = await (await ethers.getContractFactory("WalletFactory")).deploy(masterWallet.address);
        let walletAddress = await walletFactory.getWalletAddress(salts[0]);
        expect(walletAddress).to.exist;

        const tx = await walletFactory.createWallet(salts[0]);
        await tx.wait()

        const wallet1 = Wallet__factory.connect(walletAddress, owner)

        let modules = [ securityModule.address ]
        let initTx = await wallet1.initialize(
            [owner.address, user1.address, user2.address], modules);
        await initTx.wait()

        expect(await wallet1.signers(0)).to.equal(owner.address)
        expect(await wallet1.signers(1)).to.equal(user1.address)

        let depositAmount = ethers.utils.parseEther("10")
        let amount = ethers.utils.parseEther("0.01")
        // deposit to wallet
        await (await owner.sendTransaction({to: wallet1.address, value: depositAmount})).wait()

        //call by owner
        //await (await securityModule.triggerRecovery(wallet1.address, user3.address, user2.address)).wait()

        let abi = ["function triggerRecovery(address _wallet, address _recovery, address _removed)"]
        let iface = new ethers.utils.Interface(abi);
        let data = iface.encodeFunctionData( "triggerRecovery",[
            wallet1.address, user3.address, user2.address])

        /*
        abi = ["function foo(address a,uint256 bb)"] //, "call foo", 123)
        iface = new ethers.utils.Interface(abi)
        data = iface.encodeFunctionData("foo", [wallet1.address, 123])
        */
        console.log(data);
        const expireTime = Math.floor((new Date().getTime()) / 1000) + 600; // 60 seconds
        let sequenceId = 1
        let operationHash = await helpers.getSha3ForConfirmationTx(
            "ETHER",
            securityModule.address,
            0,
            data,
            expireTime,
            sequenceId
        );

        let sig = await user2.signMessage(operationHash)
        let res = await wallet1.sendMultiSig(
            securityModule.address, 0, data, expireTime, sequenceId, sig,
            overrides
        );
        let rec = await res.wait()
        await expect(res).to.emit(wallet1, "Transacted")

        let isin = await securityModule.isInRecovery(wallet1.address)
        console.log("done", isin)
    }).timeout(10000000);

    it("Add Module", async () => {
        // 1. create module
        // 2. register module to registry
        // 3. add module to wallet
    })
});
