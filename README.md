# Eigen Non-Custodial Wallet

Eigen NCW(Self-custodial Wallet) allows you:

- [x] Use multi-signature to manager your asset
- [x] Recover the owner by social recovery
- [x] Lockable
- [x] Payment Limitation
- [ ] Claim your secret or reputation without privacy breach

Implemented by Hardhat and OpenZeppelin, aims to be:
* Upgradeable and Modular
* Security
* Scalablity
* Simplicity

# Test

setup the rpc and account in .env or use `npx hardhat node`.

```
yarn build
yarn test --network localhost
```
# Different operations' gas cost
After running 'yarn test --network localhost', there is a gas report of different operations' gas cost at the end of test result.Here are some operations' gas costs that we tested.
| Operation                            | 3 signers | 5 signers | 7 signers |
|  :------:                            | :-------: | :-------: | :-------: |
|  flush                               | 30229     | 30229     | 30229     |
|  triggerRecovery                     | 76719     | 76719     | 76719     |
|  cancelRecovery                      | 16253     | 16253     | 16253     |
|  executeRecovery                     | 40939     | 40939     | 40939     |
|  lock                                | 66395     | 72917     | 77241     |
|  unlock                              | 44453     | 50975     | 55299     |
|  replaceSigner                       | 53401     | 59923     | 64235     |
|  removeSigner                        | 51572     | 61995     | 66319     |
|  addSigner                           | 89543     | 97559     | 98697     |
|  executeTransaction                  | 142153    | 142165    | 142165    |
|  executeLargeTransaction             | 22729     | 22729     | 22729     |
|  multicall                           | 145524    | 167230    | 181109    |       

# Verify contract on etherscan
You need to add the following Etherscan config to your hardhat.config.js file:
```
module.exports = {
  networks: {
    mainnet: { ... }
  },
  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://etherscan.io/
    apiKey: "YOUR_ETHERSCAN_API_KEY"
  }
};
```
Alternatively you can specify more than one block explorer API key, by passing an object under the apiKey property, see Multiple API keys and alternative block explorers.
Lastly, run the verify task, passing the address of the contract, the network where it's deployed, and the constructor arguments that were used to deploy it (if any):
```
npx hardhat verify --network mainnet DEPLOYED_CONTRACT_ADDRESS "Constructor argument 1"
```