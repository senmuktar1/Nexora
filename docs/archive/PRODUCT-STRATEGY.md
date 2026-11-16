# NEXORA product strategy

**Positioning:** The unified financial terminal for Stellar.  
**Promise:** Discover. Analyze. Access. Pay.

## 1. Product direction

NEXORA's first release focuses on four product modules that fit naturally together in Stellar's asset and financial-services ecosystem:

1. Tokenized real-world asset discovery.
2. Yield aggregation.
3. Lending and borrowing.
4. Payment vouchers.

Wallet connectivity, portfolio visibility, asset verification and transaction transparency are shared foundations. Advanced trading, a token launchpad and AI/MCP capabilities remain later-phase modules.

## 2. Problem

Stellar users encounter tokenized funds, yield products, lending pools and payment infrastructure across different issuer websites, wallets, protocol applications and explorers. Understanding what an asset represents, who can access it, what yield actually means, what risks apply, and how a payment claim works can require moving between many interfaces.

NEXORA aims to provide one coherent discovery and access experience, with consistent asset identity, source provenance, market/protocol information and explicit wallet authorization.

## 3. Initial target users

**Primary:** Stellar wallet users who want to discover tokenized RWAs, understand yield-bearing assets, compare lending opportunities and use simple onchain payment vouchers.

**Secondary:** Stellar ecosystem teams, fintech operators and merchants who need a clear way to present supported tokenized assets, yield and voucher-based payment flows.

Validate these segments with interviews before expanding to institutions, regulated distributors or other audiences. Do not claim user demand, partnerships or traction that has not been evidenced.

## 4. First-release modules

### A. Tokenized RWA discovery

Build an issuer-aware directory and asset detail experience for assets actually issued on Stellar.

For every record, show where available:
- issuer name, issuer website and official documentation;
- Stellar classic asset code and issuer account, or Soroban contract address;
- asset type, underlying exposure and denomination;
- onchain authorization, transfer, freeze or clawback characteristics where applicable;
- issuer eligibility rules, supported jurisdictions, required onboarding and minimums, if documented;
- subscription, redemption, transfer and liquidity conditions, if documented;
- NAV/price, distribution/yield information and the source timestamp;
- verification state, unavailable fields and source provenance.

Initial issuer/product references for research include Franklin Templeton's BENJI, Ondo's USDY, and Spiko/Amundi tokenized funds such as SAFO. These are discovery research targets, not a promise that a specific token identifier is verified, that a user's wallet is eligible, or that an asset is liquid and tradeable through NEXORA.

**Scope boundary:** NEXORA discovers and surfaces issuer-created assets. It does not issue securities, manage a fund, underwrite backing, guarantee redemption or bypass issuer transfer controls. Any future issuer launch/issuance service is a separate later-phase product with legal, issuer, compliance and operational requirements.

### B. Yield aggregator

Bring eligible Stellar yield opportunities into one comparison workflow. Evaluate DeFindex for vault/strategy aggregation and include yield-bearing RWAs only when their terms and source data can be verified.

For each opportunity:
- distinguish supply APY, reward APY, trailing realized yield, target/indicative yield and issuer coupon/distribution;
- display gross versus net yield, fees, incentive tokens, compounding assumptions and observation window where available;
- show the vault/strategy, underlying assets, protocol/issuer, source link and last-updated time;
- surface liquidity, lockup, withdrawal delay, eligibility and smart-contract/issuer dependencies;
- mark stale, estimated or incomplete data rather than filling gaps.

Never rank strategies by one unexplained APY number. A yield figure is not a guarantee or a risk score.

### C. Lending and borrowing

Build the lending module around verified pool and reserve data, not a single provider assumption. Blend v2 is one protocol candidate, but protocol status, active pools, integrations and SCF eligibility must be checked against current primary documentation immediately before implementation and grant submission. Do not rely on old integration-list copies or third-party market summaries.

Evaluate Blend pools alongside other currently active Stellar lending markets (including Templar where supported) before choosing the initial integration. Verify the exact contract addresses, pool status, reserve assets, API/SDK availability, current risk parameters, oracle, backstop and Testnet support. The interface should explain:
- pool and reserve state;
- supplied and borrowed assets;
- supply APY and borrow APR, with incentive components separated;
- utilization and available liquidity;
- collateral factors, liquidation thresholds and oracle source where available;
- backstop/insurance model and pool administrator/configuration risks;
- deposit, borrow, repay and withdraw transaction previews.

Acceptance is not a claim that every pool is safe or liquid. Start read-only. Add wallet-signed Testnet actions only for a selected, verified pool after transaction simulation/preflight, risk review and integration tests are complete.

### D. Payment vouchers

Build a Stellar-native voucher experience:
1. Creator chooses a supported asset and amount.
2. Creator sets recipient/claim conditions and expiry where supported.
3. Funds are committed to the selected onchain voucher mechanism.
4. NEXORA generates a shareable link and QR.
5. Recipient connects a compatible wallet and reviews the voucher.
6. Recipient claims; creator sees a verifiable claim state. Expired voucher refunds follow the explicit contract/protocol rules.

Implementation decision: compare Stellar native Claimable Balances (simpler fixed-claimant/time-predicate transfers) with a Soroban escrow contract (more flexible voucher IDs, claim state and refund logic). Select only after a threat model and Testnet prototype. Do not call a voucher bearer/non-custodial until the chosen design's key/control model is clear. NEXORA must not hold private keys or secretly control user funds.

Fiat cash-out, card payments and local-currency redemption are not included in the first voucher milestone. They require a real provider, supported corridor, eligibility/compliance and a tested payout flow.

## 5. Shared foundations

- Stellar Wallets Kit or another maintained, compatible wallet adapter.
- Testnet/Mainnet separation; Testnet default.
- Read-only account, balance and position views.
- Curated issuer/asset/protocol registries.
- Provenance, timestamps, data quality and stale-source handling.
- Human-readable transaction summaries and explicit wallet signatures.
- Supabase only for data that needs persistence; avoid unnecessary user-data collection.

## 6. Later-phase modules

### A. Advanced trading terminal, DEX routing and swap execution

This is a dedicated follow-on phase after the first release of RWA, yield, lending and payment vouchers. It is part of the NEXORA product vision, but should not be added to the first SCF MVP scope.

Planned capabilities:
- Stellar asset-pair discovery and market watchlists;
- order-book bid/ask depth and AMM pool liquidity;
- market charts, recent trades and volume where supported by reliable indexed sources;
- comparable exact-in and exact-out swap quotes;
- multi-hop and split routing where the selected router actually supports it;
- transparent minimum received, price impact, slippage tolerance, network fee, provider fee, route and quote expiry;
- transaction preflight/simulation, explicit wallet signing and onchain result verification.

Provider evaluation:
- compare Soroswap Routing API and Stellar Broker against the native Stellar path-payment flow;
- select one primary route provider for the first implementation;
- add a second provider only if measured coverage, reliability or quote quality justifies the operational cost;
- never promise the "best rate" universally; display the route, source and timestamp of the quote returned at that moment.

Acceptance: at least one end-to-end Testnet swap works through a verified route, with user review and wallet signing, and tests cover stale quotes, no liquidity, unsupported assets, network mismatch, price-impact/slippage limits and failed submissions.

### B. Other later-phase modules

1. Token launchpad and issuer lifecycle tooling.
2. AI research agent, universal intent bar and read-only MCP server; transaction preparation may follow, but signing stays with the user.
3. Additional payment rails, fiat on/off-ramps and merchant disbursement integrations.

## 7. Validation before claiming product-market fit

- Conduct 15–20 structured interviews with Stellar users interested in RWAs, yield, lending or digital payment vouchers.
- Test the four workflows with at least 10 target users.
- Obtain protocol/provider guidance and document which data/API/contract interfaces are available.
- Confirm regional access and issuer eligibility for the intended audience, including the Nigeria use case if targeted.
- Record pilot commitments, repeat usage and user feedback. Social impressions and waitlist signups alone are not product-market fit.

## 8. Success measures

- Number of RWA records with verified issuer, asset identifier, source and eligibility documentation.
- Percentage of displayed yield data with explicit methodology and freshness.
- Number of lending pools with complete, current risk/parameter data.
- Voucher creation, claim, expiry and refund success rates.
- Unique connected wallets and repeat users.
- Successful, confirmed Testnet transactions by module.
- Mainnet confirmed usage and attributable transaction volume after a production release.

## 9. Non-negotiable product principles

- Never invent asset prices, NAV, APY, TVL, pool liquidity or issuer details.
- Separate issuer-reported, protocol-reported, onchain-verifiable and estimated information.
- Show the source and timestamp for changing financial information.
- Do not infer that an asset is regulated, audited, safe or redeemable merely because it is tokenized.
- Do not bypass issuer KYC/eligibility or transfer controls.
- No autonomous AI signing or custody.
- No Mainnet transactions until production readiness is independently checked.
