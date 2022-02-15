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
| Operation                            | 3 signers | 5 signers | 7 signers |
|  :------:                            | :-------: | :-------: | :-------: |
|  flush                               |  9049     | 9049      | 9049      |
|  triggerRecovery                     | 76719     | 76719     | 76719     |
|  cancelRecovery                      | 16253     | 16253     | 16253     |
|  executeRecovery                     | 30239     | 30239     | 30239     |
|  lock                                | 23033     | 23033     | 23033     |
|  unlock                              | 3969      | 3969      | 3969      |
|  replaceSigner                       | 25352     | 25352     | 25352     |
|  removeSigner                        | 32889     | 32889     | 32889     |
|  addSigner                           | 62979     | 62979     | 62979     |
|  executeTransaction                  | 72743     | 72743     | 72743     |
|  executeLargeTransaction             | 22729     | 22729     | 22729     |
|  multicall(triggerRecovery)          | 163260    | 176000    | 189784    |       
|  multicall(executeLargeTransaction)  | 115515    | 127318    | 140139    | 
