# Eigen Non-Custodial Wallet

Eigen NCW(Non-custodial Wallet) allows you:

- [x] Use multi-signature to manager your asset
- [x] Recover any signer by social recovery
- [x] Lockable
- [ ] Payment Limitation
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
