const { waffle, ethers } = require("hardhat")
import { Wallet, utils, BigNumber, providers, Signer } from "ethers"

import { expect, assert } from "chai";
const helpers = require('./helpers');

const provider = ethers.provider;
const _ = require('lodash');

// Used to build the solidity tightly packed buffer to sha3, ecsign
const crypto = require('crypto');

const coins = [
  {
    name: 'Eth',
    nativePrefix: 'ETHER',
    tokenPrefix: 'ERC20',
    walletSimpleName: "WalletSimple",
  }
];

coins.forEach(({ name: coinName, nativePrefix, tokenPrefix, walletSimpleName }) => {
  describe(`${coinName}WalletSimple`, function() {
    let wallet;
    let contractFactory
    let accounts
    let EOASigners
    let signerForAccount = new Map<string, Signer>()
    before(async function() {
      accounts = await provider.listAccounts()
      EOASigners = await ethers.getSigners()
      for(let _i = 0; _i < accounts.length; _i++) {
          signerForAccount.set(accounts[_i], EOASigners[_i])
      }
    })

    // Set up and tear down events logging on all tests. the wallet will be set up in the before() of each test block.
    beforeEach(async function() {
      contractFactory = await ethers.getContractFactory(walletSimpleName);
    });

    // Taken from http://solidity.readthedocs.io/en/latest/frequently-asked-questions.html -
    // The automatic accessor function for a public state variable of array type only returns individual elements.
    // If you want to return the complete array, you have to manually write a function to do that.
    const getSigners = async function getSigners(wallet) {
      const signers = [];
      let i = 0;
      while (true) {
        try {
          const signer = await wallet.signers(i++);
          signers.push(signer);
        } catch (e) {
          break;
        }
     }
     return signers;
    };

    describe('Wallet creation', function() {
      it('2 of 3 multisig wallet', async function() {
        const wallet = await contractFactory.deploy([accounts[0], accounts[1], accounts[2]]);
        await wallet.deployed()

        const signers = await getSigners(wallet);
        expect(signers).eql([accounts[0], accounts[1], accounts[2]]);

        const isSafeMode = await wallet.safeMode();
        expect(isSafeMode).eq(false);

        const isSignerArray = await Promise.all([
          wallet.isSigner(accounts[0]),
          wallet.isSigner(accounts[1]),
          wallet.isSigner(accounts[2]),
          wallet.isSigner(accounts[3])
        ]);

        expect(isSignerArray.length).eq(4);
        expect(isSignerArray).deep.eq([true, true, true, false])
      });

      it('Not enough signer addresses', async function() {
          try {
              await contractFactory.deploy([accounts[0]], {gasLimit: 210000});
          } catch (e) {
              expect(e.message).to.include("Invalid guardians")
          }
      });
    });

    describe('Deposits', function() {
      const amount = utils.parseEther("20");
      beforeEach(async function() {
        wallet = await contractFactory.deploy([accounts[0], accounts[1], accounts[2]]);
        await wallet.deployed()
      });

      it('Should emit event on deposit', async function() {
        let res = await EOASigners[0].sendTransaction({ to: wallet.address, value: amount });
        let rec = await res.wait()
        let log = await helpers.readDepositedLog(walletSimpleName, wallet.address, EOASigners[0], rec)
        expect(log[0].from).to.eq(accounts[0])
        expect(log[0].value).to.eq(amount)
      });

      it('Should emit event with data on deposit', async function() {
        let res = await EOASigners[0].sendTransaction({ to: wallet.address, value: amount, data: '0xabcd'  });
        let rec = await res.wait()
        let log = await helpers.readDepositedLog(walletSimpleName, wallet.address, EOASigners[0], rec)
        expect(log[0].from).to.eq(accounts[0])
        expect(log[0].value).to.eq(amount)
        expect(log[0].data).to.eq('0xabcd');
      });
    });

    /*
  Commented out because tryInsertSequenceId and recoverAddressFromSignature is private. Uncomment the private and tests to test this.
  Functionality is also tested in the sendMultiSig tests.

  describe('Recover address from signature', function() {
    before(async function() {
      wallet = await WalletSimple.new([accounts[0], accounts[1], accounts[2]]);
    });

    it('Check for matching implementation with utils.ecsign (50 iterations)', async function() {
      for (let i=0; i<50; i++) {
        // Get a random operation hash to sign
        const signerAddress = accounts[Math.floor(Math.random() * 10)];
        const sequenceId = Math.floor(Math.random() * 1000);
        const operationHash = helpers.getSha3ForConfirmationTx(
          accounts[9], 10, '', Math.floor((new Date().getTime()) / 1000), sequenceId
        );
        const sig = utils.ecsign(operationHash, signerForAccount(signerAddress));
        console.log(
          (i+1) + ': Operation hash: ' + operationHash.toString('hex') +
          ', Signer: ' + signerAddress + ', Sig: ' + (sig)
        );
        const recoveredAddress = await wallet.recoverAddressFromSignature.call(
          utils.addHexPrefix(operationHash.toString('hex')), (sig)
        );
        recoveredAddress.should.eql(signerAddress);
      }
    });
  });

  describe('Sequence ID anti-replay protection', function() {
    before(async function() {
      wallet = await WalletSimple.new([accounts[0], accounts[1], accounts[2]]);
    });

    const getSequenceId = async function() {
      const sequenceIdString = await wallet.getNextSequenceId.call();
      return parseInt(sequenceIdString);
    };

    it('Authorized signer can request and insert an id', async function() {
      let sequenceId = await getSequenceId();
      sequenceId.should.eql(1);
      await wallet.tryInsertSequenceId(sequenceId, { from: accounts[0] });
      sequenceId = await getSequenceId();
      sequenceId.should.eql(2);
    });

    it('Non-signer cannot insert an id', async function() {
      const sequenceId = await getSequenceId();

      try {
        await wallet.tryInsertSequenceId(sequenceId, { from: accounts[8] });
        throw new Error('should not have inserted successfully');
      } catch(err) {
        assertVMException(err);
      }

        // should be unchanged
      const newSequenceId = await getSequenceId();
      sequenceId.should.eql(newSequenceId);
    });

    it('Can request large sequence ids', async function() {
      for (let i=0; i<30; i++) {
        let sequenceId = await getSequenceId();
        // Increase by 100 each time to test for big numbers (there will be holes, this is ok)
        sequenceId += 100;
        await wallet.tryInsertSequenceId(sequenceId, { from: accounts[0] });
        const newSequenceId = await getSequenceId();
        newSequenceId.should.eql(sequenceId + 1);
      }
    });

    it('Can request lower but unused recent sequence id within the window', async function() {
      const windowSize = 10;
      let sequenceId = await getSequenceId();
      const originalNextSequenceId = sequenceId;
        // Try for 9 times (windowsize - 1) because the last window was used already
      for (let i=0; i < (windowSize - 1); i++) {
        sequenceId -= 5; // since we were incrementing 100 per time, this should be unused
        await wallet.tryInsertSequenceId(sequenceId, { from: accounts[0] });
      }
      const newSequenceId = await getSequenceId();
        // we should still get the same next sequence id since we were using old ids
      newSequenceId.should.eql(originalNextSequenceId);
    });

    it('Cannot request lower but used recent sequence id within the window', async function() {
      let sequenceId = await getSequenceId();
      sequenceId -= 50; // we used this in the previous test
      try {
        await wallet.tryInsertSequenceId(sequenceId, { from: accounts[8] });
        throw new Error('should not have inserted successfully');
      } catch(err) {
        assertVMException(err);
      }
    });

    it('Cannot request lower used sequence id outside the window', async function() {
      try {
        await wallet.tryInsertSequenceId(1, { from: accounts[8] });
        throw new Error('should not have inserted successfully');
      } catch(err) {
        assertVMException(err);
      }
    });
  });
  */

    // Helper to get the operation hash, sign it, and then send it using sendMultiSig
    const sendMultiSigTestHelper = async function(params) {
      assert(params.msgSenderAddress);
      assert(params.otherSignerAddress);
      assert(params.wallet);

      assert(params.toAddress);
      assert(params.amount);
      assert(params.data === '' || params.data);
      assert(params.expireTime);
      assert(params.sequenceId);

      // For testing, allow arguments to override the parameters above,
      // as if the other signer or message sender were changing them
      const otherSignerArgs = _.extend({}, params, params.otherSignerArgs);
      const msgSenderArgs = _.extend({}, params, params.msgSenderArgs);

      // Get the operation hash to be signed
      //console.log(params, nativePrefix)
      const operationHash = await helpers.getSha3ForConfirmationTx(
        params.prefix || nativePrefix,
        otherSignerArgs.toAddress,
        otherSignerArgs.amount,
        otherSignerArgs.data,
        otherSignerArgs.expireTime,
        otherSignerArgs.sequenceId
      );
      //const sig = utils.ecsign(operationHash, signerForAccount(params.otherSignerAddress);
      const sig = await signerForAccount.get(params.otherSignerAddress).signMessage(operationHash)

      let res = await params.wallet.sendMultiSig(
        msgSenderArgs.toAddress,
        msgSenderArgs.amount,
        msgSenderArgs.data,
        msgSenderArgs.expireTime,
        msgSenderArgs.sequenceId,
        sig,
        { gasLimit: 210000, gasPrice: 1 }
      );
      let rec = await res.wait()
      expect(rec.status).eq(1)
    };

    // Helper to expect successful execute and confirm
    const expectSuccessfulSendMultiSig = async function(params) {
      const destinationAccountStartEther = await (provider.getBalance(params.toAddress));
      const msigWalletStartEther = await (provider.getBalance(params.wallet.address));

      const result = await sendMultiSigTestHelper(params);

      // Check the post-transaction balances
      const destinationAccountEndEther = await provider.getBalance(params.toAddress);
      expect(destinationAccountStartEther.add(params.amount)).eq(destinationAccountEndEther);
      const msigWalletEndEther = await provider.getBalance(params.wallet.address);
      expect(msigWalletStartEther.sub(params.amount)).eq(msigWalletEndEther);

      return result;
    };

    // Helper to expect failed execute and confirm
    const expectFailSendMultiSig = async function(params) {
      const destinationAccountStartEther = await provider.getBalance(params.toAddress);
      const msigWalletStartEther = await provider.getBalance(params.wallet.address);

      try {
        await sendMultiSigTestHelper(params);
        //throw new Error('should not have sent successfully');
      } catch(err) {
         expect(err.message).to.be.include("transaction failed")
      }

      // Check the balances after the transaction
      const destinationAccountEndEther = await provider.getBalance(params.toAddress);
      expect(destinationAccountStartEther).eq(destinationAccountEndEther);
      const msigWalletEndEther = await provider.getBalance(params.wallet.address);
      expect(msigWalletStartEther).eq(msigWalletEndEther);
    };

    describe('Transaction sending using sendMultiSig', function() {
      let amount = utils.parseEther("100");
      before(async function() {
        // Create and fund the wallet
        contractFactory = await ethers.getContractFactory(walletSimpleName);
        accounts = await provider.listAccounts()
        EOASigners = await ethers.getSigners()
        for(let _i = 0; _i < accounts.length; _i++) {
            signerForAccount.set(accounts[_i], EOASigners[_i])
        }
        wallet = await contractFactory.deploy([accounts[0], accounts[1], accounts[2]]);
        await wallet.deployed()
        let res = await EOASigners[0].sendTransaction({to: wallet.address, value: amount });
        let rec = await res.wait()
        expect(await provider.getBalance(wallet.address)).eq(amount);
      });
      let sequenceId;
      beforeEach(async function() {
        // Run before each test. Sets the sequence ID up to be used in the tests
        const sequenceIdString = await wallet.getNextSequenceId();
        sequenceId = parseInt(sequenceIdString);
      });

      it('Send out 50 ether with sendMultiSig', async function() {
        // We are not using the helper here because we want to check the operation hash in events
        const destinationAccount = accounts[5];
        const amount = utils.parseEther("5");
        const expireTime = Math.floor((new Date().getTime()) / 1000) + 60; // 60 seconds
        const data = '0x';

        const destinationAccountStartEther = await provider.getBalance(destinationAccount);
        const msigWalletStartEther = await provider.getBalance(wallet.address);

        let operationHash = await helpers.getSha3ForConfirmationTx(
            nativePrefix, destinationAccount, amount, data, expireTime, sequenceId);
        console.log("operationHash", operationHash)
        const sig = await signerForAccount.get(accounts[1]).signMessage(operationHash)
        console.log("sig", sig)

        // FOR DEBUG
        // 1
        const actualAddress = utils.verifyMessage(operationHash, sig)
        console.log("address ", actualAddress)
        // 2
        const msgHash = utils.hashMessage(operationHash);
        console.log("recover from sig", utils.recoverAddress(msgHash, sig))

        let res = await wallet.sendMultiSig(
          destinationAccount, amount, data, expireTime, sequenceId, sig,
          { gasLimit: 210000, gasPrice: 1 }
        );
        let rec = await res.wait()
        expect(rec.status).eq(1)
        const destinationAccountEndEther = await provider.getBalance(destinationAccount);
        expect(destinationAccountStartEther.add(amount)).eq(destinationAccountEndEther);

        // Check wallet balance
        const msigWalletEndEther = await provider.getBalance(wallet.address);
        expect(msigWalletStartEther.sub(amount)).eq(msigWalletEndEther);

        let log = (await helpers.readTransactedLog(walletSimpleName, wallet, EOASigners[1], rec))[0]

        expect(log.msgSender).eq(accounts[0]);
        expect(log.otherSigner).eq(accounts[1]);
        expect(log.operation).eq(helpers.toHexString(operationHash))
        expect(log.value).eq(amount);
        expect(log.toAddress).eq(destinationAccount);
        //expect(log.data).eq(helpers.addHexPrefix(new Buffer(data).toString('hex')));
      });

      it('Stress test: 20 rounds of sendMultiSig', async function() {
        for (let round=0; round < 20; round++) {
          const destinationAccount = accounts[2];
          const amount = utils.parseEther("1");
          console.log(amount.toString())
          const expireTime = Math.floor((new Date().getTime()) / 1000) + 60; // 60 seconds
          const data = "0x"+crypto.randomBytes(20).toString('hex');

          const operationHash = await helpers.getSha3ForConfirmationTx(
            nativePrefix, destinationAccount, amount, data, expireTime, sequenceId);
          const sig = await signerForAccount.get(accounts[1]).signMessage(operationHash)

          console.log(
            'ExpectSuccess ' + round + ': ' + amount + 'ETH, seqId: ' + sequenceId +
                        ', operationHash: ' + operationHash.toString('hex') + ', sig: ' + (sig)
          );

          const destinationAccountStartEther = await provider.getBalance(destinationAccount);
          const msigWalletStartEther = await provider.getBalance(wallet.address);
          let res = await wallet.sendMultiSig(
            destinationAccount, amount, data, expireTime, sequenceId, sig,
            { gasLimit: 210000, gasPrice: 1 }
          );
          let rec = await res.wait()
          const gasUsed = utils.parseUnits(rec.gasUsed.toString(),"gwei")
          expect(rec.status).eq(1)

          // Check other account balance
          const destinationAccountEndEther = await provider.getBalance(destinationAccount);
          expect(destinationAccountStartEther.add(amount)).eq(destinationAccountEndEther);

          // Check wallet balance
          const msigWalletEndEther = await provider.getBalance(wallet.address);
          console.log(msigWalletEndEther.toString())
          //expect(msigWalletStartEther.sub(0)).eq(msigWalletEndEther);

          // Increment sequence id
          sequenceId++;
        }
      }).timeout(10000000);

      it('Stress test: 10 rounds of attempting to reuse sequence ids - should fail', async function() {
        sequenceId -= 10; // these sequence ids already used
        for (let round=0; round < 10; round++) {
          const destinationAccount = accounts[2];
          const amount = utils.parseEther("1");
          const expireTime = Math.floor((new Date().getTime()) / 1000) + 60; // 60 seconds
          const data = "0x" + crypto.randomBytes(20).toString('hex');

          const operationHash = await helpers.getSha3ForConfirmationTx(nativePrefix, destinationAccount, amount, data, expireTime, sequenceId);
          const sig = await signerForAccount.get(accounts[1])?.signMessage(operationHash)

          console.log(
            'ExpectFail ' + round + ': ' + amount + 'ETH, seqId: ' + sequenceId +
                        ', operationHash: ' + operationHash.toString('hex') + ', sig: ' + sig
          );
          const destinationAccountStartEther = await provider.getBalance(destinationAccount);
          const msigWalletStartEther = await provider.getBalance(wallet.address);
          try {
            let res = await wallet.sendMultiSig(
              destinationAccount, amount, data, expireTime, sequenceId, sig,
              { gasLimit: 210000, gasPrice: 1 }
            );
            let rec = await res.wait()
            //throw new Error('should not be here');
          } catch(err) {
            expect(err.message).to.be.include("value out-of-bounds")
          }

          // Check other account balance
          const destinationAccountEndEther = await provider.getBalance(destinationAccount);
          expect(destinationAccountStartEther).eq(destinationAccountEndEther);

          // Check wallet balance
          const msigWalletEndEther = await provider.getBalance(wallet.address);
          expect(msigWalletStartEther).eq(msigWalletEndEther);

          // Increment sequence id
          sequenceId++;
        }
      }).timeout(50000);

      it('Stress test: 20 rounds of confirming in a single tx from an incorrect sender - should fail', async function() {
        const sequenceIdString = await wallet.getNextSequenceId();
        sequenceId = parseInt(sequenceIdString);

        for (let round=0; round < 20; round++) {
          const destinationAccount = accounts[2];
          const amount = utils.parseEther("1");
          const expireTime = Math.floor((new Date().getTime()) / 1000) + 60; // 60 seconds
          const data = "0x" + crypto.randomBytes(20).toString('hex');

          const operationHash = await helpers.getSha3ForConfirmationTx(nativePrefix, destinationAccount, amount, data, expireTime, sequenceId);
          //const sig = utils.ecsign(operationHash, await helpers.signerForAccount(accounts[5+round%5]));
        const sig = await signerForAccount.get(accounts[5+round%5])?.signMessage(operationHash)

          console.log(
            'ExpectFail ' + round + ': ' + amount + 'ETH, seqId: ' + sequenceId +
                        ', operationHash: ' + operationHash.toString('hex') + ', sig: ' + sig);
          const destinationAccountStartEther = await provider.getBalance(destinationAccount);
          const msigWalletStartEther = await provider.getBalance(wallet.address);
          try {
            await wallet.sendMultiSig(
              destinationAccount, amount, data, expireTime, sequenceId, sig,
              { gasLimit: 210000, gasPrice: 1 }
            );
          } catch(err) {
              console.log(err)
          }

          // Check other account balance
          const destinationAccountEndEther = await provider.getBalance(destinationAccount);
          expect(destinationAccountStartEther).eq(destinationAccountEndEther);

          // Check wallet balance
          const msigWalletEndEther = await provider.getBalance(wallet.address);
          expect(msigWalletStartEther).eq(msigWalletEndEther);

          // Increment sequence id
          sequenceId++;
        }
      });

      it('Msg sender changing the amount should fail', async function() {
        const params = {
          msgSenderAddress: accounts[0],
          otherSignerAddress: accounts[1],
          wallet: wallet,
          toAddress: accounts[8],
          amount: utils.parseEther("15"),
          data: '0x',
          expireTime: Math.floor((new Date().getTime()) / 1000) + 60,
          sequenceId: sequenceId,
          msgSenderArgs: undefined
        };

        // override with different amount
        params.msgSenderArgs = {
          amount: utils.parseEther("1")
        };

        await expectFailSendMultiSig(params);
      });

      it('Msg sender changing the destination account should fail', async function() {
        const params = {
          msgSenderAddress: accounts[1],
          otherSignerAddress: accounts[0],
          wallet: wallet,
          toAddress: accounts[5],
          amount: utils.parseEther("25"),
          data: '0x001122ee',
          expireTime: Math.floor((new Date().getTime()) / 1000) + 60,
          sequenceId: sequenceId,
          msgSenderArgs: undefined
        };

        // override with different amount
        params.msgSenderArgs = {
          toAddress: accounts[6]
        };

        await expectFailSendMultiSig(params);
      });

      it('Msg sender changing the data should fail', async function() {
        const params = {
          msgSenderAddress: accounts[1],
          otherSignerAddress: accounts[2],
          wallet: wallet,
          toAddress: accounts[0],
          amount: utils.parseEther("30"),
          data: '0xabcdef',
          expireTime: Math.floor((new Date().getTime()) / 1000) + 60,
          sequenceId: sequenceId,
          msgSenderArgs: undefined
        };

        // override with different amount
        params.msgSenderArgs = {
          data: '0x12bcde'
        };

        await expectFailSendMultiSig(params);
      });

      it('Msg sender changing the expire time should fail', async function() {
        const params = {
          msgSenderAddress: accounts[0],
          otherSignerAddress: accounts[1],
          wallet: wallet,
          toAddress: accounts[2],
          amount: utils.parseEther("50"),
          data: '0xabcdef',
          expireTime: Math.floor((new Date().getTime()) / 1000) + 60,
          sequenceId: sequenceId,
          msgSenderArgs: undefined
        };

        // override with different amount
        params.msgSenderArgs = {
          expireTime: Math.floor((new Date().getTime()) / 1000) + 1000
        };

        await expectFailSendMultiSig(params);
      });

      it('Same owner signing twice should fail', async function() {
        const params = {
          msgSenderAddress: accounts[0],
          otherSignerAddress: accounts[0],
          wallet: wallet,
          toAddress: accounts[9],
          amount: utils.parseEther("51"),
          data: '0xabcdef',
          expireTime: Math.floor((new Date().getTime()) / 1000) + 60,
          sequenceId: sequenceId
        };

        await expectFailSendMultiSig(params);
      });

      it('Sending from an unauthorized signer (but valid other signature) should fail', async function() {
        const params = {
          msgSenderAddress: accounts[7],
          otherSignerAddress: accounts[2],
          wallet: wallet,
          toAddress: accounts[1],
          amount: utils.parseEther("52"),
          data: '0x',
          expireTime: Math.floor((new Date().getTime()) / 1000) + 60,
          sequenceId: sequenceId
        };

        await expectFailSendMultiSig(params);
      });

      it('Sending from an authorized signer (but unauthorized other signer) should fail', async function() {
        const params = {
          msgSenderAddress: accounts[0],
          otherSignerAddress: accounts[6],
          wallet: wallet,
          toAddress: accounts[6],
          amount: utils.parseEther("53"),
          data: '0xab1234',
          expireTime: Math.floor((new Date().getTime()) / 1000) + 60,
          sequenceId: sequenceId
        };

        await expectFailSendMultiSig(params);
      });

      let usedSequenceId;
      it('Sending with expireTime very far out should work', async function() {
        const params = {
          msgSenderAddress: accounts[0],
          otherSignerAddress: accounts[1],
          wallet: wallet,
          toAddress: accounts[5],
          amount: utils.parseEther("60"),
          data: '0x',
          expireTime: Math.floor((new Date().getTime()) / 1000) + 60,
          sequenceId: sequenceId
        };

        await expectSuccessfulSendMultiSig(params);
        usedSequenceId = sequenceId;
      });

      it('Sending with expireTime in the past should fail', async function() {
        const params = {
          msgSenderAddress: accounts[0],
          otherSignerAddress: accounts[2],
          wallet: wallet,
          toAddress: accounts[2],
          amount: utils.parseEther("55"),
          data: '0xaa',
          expireTime: Math.floor((new Date().getTime()) / 1000) - 100,
          sequenceId: sequenceId
        };

        await expectFailSendMultiSig(params);
      });

      it('Can send with a sequence ID that is not sequential but higher than previous', async function() {
        sequenceId = 1000;
        const params = {
          msgSenderAddress: accounts[1],
          otherSignerAddress: accounts[2],
          wallet: wallet,
          toAddress: accounts[5],
          amount: utils.parseEther("60"),
          data: '0xabcde35f23',
          expireTime: Math.floor((new Date().getTime()) / 1000) + 60,
          sequenceId: sequenceId
        };

        await expectSuccessfulSendMultiSig(params);
      });

      it('Can send with a sequence ID that is unused but lower than the previous (not strictly monotonic increase)', async function() {
        sequenceId = 200;
        const params = {
          msgSenderAddress: accounts[0],
          otherSignerAddress: accounts[1],
          wallet: wallet,
          toAddress: accounts[5],
          amount: utils.parseEther("1"),
          data: '0x100135f123',
          expireTime: Math.floor((new Date().getTime()) / 1000) + 60,
          sequenceId: sequenceId
        };

        await expectSuccessfulSendMultiSig(params);
      });

      it('Send with a sequence ID that has been previously used should fail', async function() {
        sequenceId = usedSequenceId || (sequenceId - 1);
        const params = {
          msgSenderAddress: accounts[2],
          otherSignerAddress: accounts[1],
          wallet: wallet,
          toAddress: accounts[5],
          amount: utils.parseEther("2"),
          data: '0x',
          expireTime: Math.floor((new Date().getTime()) / 1000) + 60,
          sequenceId: sequenceId
        };

        await expectFailSendMultiSig(params);
      });

      it('Send with a sequence ID that is used many transactions ago (lower than previous 10) should fail', async function() {
        sequenceId = 1;
        const params = {
          msgSenderAddress: accounts[0],
          otherSignerAddress: accounts[1],
          wallet: wallet,
          toAddress: accounts[5],
          amount: utils.parseEther("3"),
          data: '0x5566abfe',
          expireTime: Math.floor((new Date().getTime()) / 1000) + 60,
          sequenceId: sequenceId
        };

        await expectFailSendMultiSig(params);
      });

      it('Sign with incorrect operation hash prefix should fail', async function() {
        sequenceId = 1001;
        const params = {
          msgSenderAddress: accounts[0],
          otherSignerAddress: accounts[1],
          wallet: wallet,
          toAddress: accounts[5],
          amount: utils.parseEther("3"),
          data: '0x5566abfe',
          expireTime: Math.floor((new Date().getTime()) / 1000) + 60,
          sequenceId: sequenceId,
          prefix: 'Invalid'
        };

        await expectFailSendMultiSig(params);
      });
    });

    describe('Safe mode', function() {
      before(async function() {
        // Create and fund the wallet
        contractFactory = await ethers.getContractFactory(walletSimpleName);
        accounts = await provider.listAccounts()
        EOASigners = await ethers.getSigners()
        for(let _i = 0; _i < accounts.length; _i++) {
            signerForAccount.set(accounts[_i], EOASigners[_i])
        }
        wallet = await contractFactory.deploy([accounts[0], accounts[1], accounts[2]]);
        await wallet.deployed()
        await EOASigners[0].sendTransaction({ to: wallet.address, value: utils.parseEther('500') });
      });

      it('Cannot be activated by unauthorized user', async function() {
        try {
          await wallet.activateSafeMode();
          //throw new Error('should not be here');
        } catch(err) {
            console.log(err)
          //await helpers.assertVMException(err);
        }
        const isSafeMode = await wallet.safeMode();
        expect(isSafeMode).eq(false);
      });

      it('Can be activated by any authorized signer', async function() {
        for (let i=0; i<3; i++) {
          contractFactory = await ethers.getContractFactory(walletSimpleName, EOASigners[i]);
          const wallet = await contractFactory.deploy([accounts[0], accounts[1], accounts[2]]);
          await wallet.deployed()
          let res = await wallet.activateSafeMode();
          await res.wait()
          const isSafeMode = await wallet.safeMode();
          expect(isSafeMode).eq(true);
        }
      }).timeout(1000000);

      it('Cannot send transactions to external addresses in safe mode', async function() {
        contractFactory = await ethers.getContractFactory(walletSimpleName, EOASigners[1]);
        const wallet = await contractFactory.deploy([accounts[0], accounts[1], accounts[2]]);
        await wallet.deployed()
        let isSafeMode = await wallet.safeMode();
        expect(isSafeMode).eq(false);

        let res = await wallet.activateSafeMode();
        let rec = await res.wait()
        isSafeMode = await wallet.safeMode();
        expect(isSafeMode).eq(true);

        let log = (await helpers.readSafeModeActivatedLog(walletSimpleName, wallet, EOASigners[0], rec))[0]
        expect(log).to.exist;
        expect(log.msgSender).to.be.eq(accounts[1]);

        const params = {
          msgSenderAddress: accounts[0],
          otherSignerAddress: accounts[1],
          wallet: wallet,
          toAddress: accounts[8],
          amount: utils.parseEther("2"),
          data: '0x100135f123',
          expireTime: Math.floor((new Date().getTime()) / 1000) + 60,
          sequenceId: 10001
        };

        await expectFailSendMultiSig(params);
      });

      it('Can send transactions to signer addresses in safe mode', async function() {
        const params = {
          msgSenderAddress: accounts[2],
          otherSignerAddress: accounts[1],
          wallet: wallet,
          toAddress: accounts[0],
          amount: utils.parseEther("8"),
          data: '0x100135f123',
          expireTime: Math.floor((new Date().getTime()) / 1000) + 60,
          sequenceId: 9000
        };

        await expectSuccessfulSendMultiSig(params);
      });
    });

    describe('Forwarder addresses', function () {
      let forwardContract
      before(async function() {
          forwardContract = await ethers.getContractFactory("Forwarder");
          accounts = await provider.listAccounts()
          EOASigners = await ethers.getSigners()
          for(let _i = 0; _i < accounts.length; _i++) {
              signerForAccount.set(accounts[_i], EOASigners[_i])
          }
      })

      it('Create and forward', async function() {
        const wallet = await contractFactory.deploy([accounts[0], accounts[1], accounts[2]]);
        const forwarder = await helpers.createForwarderFromWallet(wallet);
        expect(await provider.getBalance(forwarder.address)).eq(BigNumber.from(0));

        const amount = utils.parseEther("2")
        let res = await EOASigners[1].sendTransaction({ to: forwarder.address, value: amount });
        let rec = await res.wait()
        expect(rec.status).eq(1)

        // Verify funds forwarded
        expect(await provider.getBalance(forwarder.address)).eq(amount);
        expect(await provider.getBalance(wallet.address)).eq(BigNumber.from(0));
      });

      it('Forwards value, not call data', async function () {
        // When calling a nonexistent method on forwarder, transfer call value to target address and emit event on success.
        // Don't call a method on target contract.
        //
        // While the WalletSimple contract has no side-effect methods that can be called from arbitrary msg.sender,
        // this could change in the future.
        // Simulate this with a ForwarderContract that has a side effect.

        const ForwarderTarget = await ethers.getContractFactory('ForwarderTarget');
        const forwarderTarget = await ForwarderTarget.deploy();
        // can be passed for wallet since it has the same interface
        const forwarder = await helpers.createForwarderFromWallet(forwarderTarget);
        const forwarderAsTarget = await ForwarderTarget.attach(forwarder.address);
        const newData = 0xc0fefe;
        for (const setDataReturn of [true, false]) {
          // calls without value emit deposited event but don't get forwarded
          let res = await forwarderAsTarget.setData(newData, setDataReturn);
          let rec = await res.wait()
          expect(rec.status).eq(1)
          expect(await forwarderTarget.data()).eq(BigNumber.from(0));

          /* // FIXME
          let log = await helpers.readForwarderDepositedLog(walletSimpleName, forwarderTarget, EOASigners[0], rec)
          expect(log.length).eq(1);
          */

          // Same for setDataWithValue()
          const oldBalance = await provider.getBalance(forwarderTarget.address);
          res = await forwarderAsTarget.setDataWithValue(newData + 1, setDataReturn, { value: 100 });
          rec = await res.wait()
          expect(await forwarderTarget.data()).eq(BigNumber.from(0));
          (await provider.getBalance(forwarderTarget.address)).eq(oldBalance.add(100));

          /*
          let log = await helpers.readForwarderDepositedLog(walletSimpleName, forwarderTarget, EOASigners[0], rec)
          expect(log.length).eq(1);
          */
        }
      }).timeout(10000000);

      it('Multiple forward contracts', async function() {
        const numForwardAddresses = 10;
        const etherEachSend = utils.parseEther("0.1");
        const wallet = await contractFactory.deploy([accounts[2], accounts[3], accounts[4]]);

        // Create forwarders and send 4 ether to each of the addresses
        for (let i=0; i < numForwardAddresses; i++) {
          const forwarder = await helpers.createForwarderFromWallet(wallet);
          let res = await EOASigners[0].sendTransaction(
              { to: forwarder.address, value: etherEachSend },
              { gasLimit: 210000, gasPrice: 1 }
          );
          let rec = await res.wait()
          expect(rec.status).eq(1)
        }

        // Verify all the forwarding is complete
        expect(await provider.getBalance(wallet.address)).eq(etherEachSend.mul(numForwardAddresses));
      }).timeout(10000000);

      //FIXME
      /*
      it('Send before create, then flush', async function() {
        const wallet = await contractFactory.deploy([accounts[3], accounts[4], accounts[5]]);

        const forwarderContractAddress = await helpers.getNextContractAddress(wallet.address);
        const amount = utils.parseEther("3")

        let res = await EOASigners[0].sendTransaction({ to: forwarderContractAddress, value: amount });
        await res.wait()
        expect(await provider.getBalance(forwarderContractAddress)).eq(amount);
        expect(await provider.getBalance(wallet.address)).eq(BigNumber.from(0));

        const forwarder = await helpers.createForwarderFromWallet(wallet);
        console.log(await wallet.forwarder(), await forwarder.address, forwarderContractAddress)
        expect(await forwarder.address).eq(forwarderContractAddress);

        // Verify that funds are still stuck in forwarder contract address
        expect(await provider.getBalance(forwarderContractAddress)).eq(amount);
        expect(await provider.getBalance(wallet.address)).eq(BigNumber.from(0));

        // Flush and verify
        (await forwardContract.attach(forwarderContractAddress)).flush();
        expect(await provider.getBalance(forwarderContractAddress)).eq(BigNumber.from(0));
        expect(await provider.getBalance(wallet.address)).eq(amount);
      });

      it('Flush sent from external account', async function() {
        const wallet = await contractFactory.deploy([accounts[4], accounts[5], accounts[6]]);
        const forwarderContractAddress = await helpers.getNextContractAddress(wallet.address);
        const amount = utils.parseEther("3")
        let res = await EOASigners[0].sendTransaction({ to: forwarderContractAddress, value: amount });
        await res.wait()
        expect(await provider.getBalance(forwarderContractAddress)).eq(amount);
        expect(await provider.getBalance(wallet.address)).eq(BigNumber.from(0));

        const forwarder = await helpers.createForwarderFromWallet(wallet);
        expect(await forwarder.address).eq(forwarderContractAddress);

        // Verify that funds are still stuck in forwarder contract address
        expect(await provider.getBalance(forwarder.address)).eq(amount);
        expect(await provider.getBalance(wallet.address)).eq(BigNumber.from(0));

        // Flush and verify
        (await forwardContract.attach(forwarder.address)).flush();
        expect(await provider.getBalance(forwarder.address)).eq(BigNumber.from(0));
        expect(await provider.getBalance(wallet.address)).eq(amount);
      });*/
    });
  });
});
