# NEXORA contracts

## nexora-token — fixed-supply SEP-41 token

- Built on OpenZeppelin `stellar-tokens` 0.8.0 (audited Stellar contract library), `soroban-sdk` 28.0.0.
- Constructor: `(name: String, symbol: String, decimals: u32, recipient: Address, supply: i128)`.
  The full supply is minted once to `recipient`.
- Exported functions: SEP-41 (`balance`, `transfer`, `transfer_from`, `approve`, `allowance`,
  `decimals`, `name`, `symbol`), `burn`, `burn_from`, `total_supply`. **No mint function and no admin.**
- Served to the app as `public/contracts/nexora-token.wasm`, pinned by SHA-256 in
  `src/lib/stellar/soroban-token.ts` (`NEXORA_TOKEN_WASM_HASH`):
  `80d27ccd6861a5045369c83d101eb964ae2a709f4443e5f75cf96726c5038878`

### Reproduce the build

```bash
rustup target add wasm32v1-none
cargo install stellar-cli --version 30.0.1 --locked --no-default-features
cd contracts/nexora-token
cargo test                      # 7 unit tests, incl. the contract-address test vector
stellar contract build          # → target/wasm32v1-none/release/nexora_token.wasm
sha256sum target/wasm32v1-none/release/nexora_token.wasm
```

Built here with rustc 1.97.0 and stellar-cli 30.0.1, using the committed `Cargo.lock`. If you rebuild with different tools, the hash may change. In that case, copy the new wasm to `public/contracts/` and update `NEXORA_TOKEN_WASM_HASH`; the app refuses any wasm that doesn't match the pinned hash.

The contract has not been independently audited as a whole. It is thin glue around OpenZeppelin's library; see the source and tests.
