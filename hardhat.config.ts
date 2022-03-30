import '@typechain/hardhat'
import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-waffle'
import '@nomiclabs/hardhat-etherscan'

import { task, HardhatUserConfig } from "hardhat/config";
import { resolve } from "path";

import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: resolve(__dirname, "./.env") });

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }

});

module.exports = {
  solidity:{
    version: '0.8.3',
    settings: {
      optimizer: {
        enabled: true,
	runs: 200,
        details: {
	  yul: true,
	  yulDetails: {
	    stackAllocation: true,
	  }
	}	
      }
    }
  },
  typechain: {
    outDir: 'typechain',
    target: 'ethers-v5',
    alwaysGenerateOverloads: false // should overloads with full signatures like deposit(uint256) be generated always, even if there are no overloads?
  },
  mocha: {
    timeout: 10000000,
  },
  //defaultNetwork: "dev",
  networks: {
    dev: {
      url: process.env['RPC'] || process.exit(-1),
      accounts: [process.env.DEVNET_PRIVKEY],
      gas: 2100000,
      gasPrice: 3000000000
    },
    metis: {
      url: "https://stardust.metis.io/?owner=588",
      accounts: [process.env.DEVNET_PRIVKEY]
    },
    tbsc: {
      url: "https://data-seed-prebsc-1-s1.binance.org:8545",
      accounts: [process.env.DEVNET_PRIVKEY]
    }, 
    tpolygon: {
      url: "https://rpc-mumbai.maticvigil.com/",
      accounts: [process.env.DEVNET_PRIVKEY]
    }
  },
  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://etherscan.io/
    apiKey: {
      ropsten: '8HHE3RBH3MZ29E9I9XYP8VP6D9SQIINUIU'
    }   
  },
  gasReporter: {
    currency: 'USD',
    gasPrice: 20,
    token: 'ETH',
    gasPriceApi: 'https://api.etherscan.io/api?module=proxy&action=eth_gasPrice',
    coinmarketcap: 'f6673cc5-a673-4e07-8461-f7281a5de7d7',
    onlyCalledMethods: false
  }
}
