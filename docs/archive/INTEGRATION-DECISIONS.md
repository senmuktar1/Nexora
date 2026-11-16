# NEXORA Stellar integration decisions

**Review date:** 12 November 2026  
**Status:** integration candidates under diligence; no provider is a confirmed partner or deployed integration.

## First-release scope

NEXORA's first release is Tokenized RWA discovery, Yield aggregation, Lending/Borrowing and Payment Vouchers. The selected components must serve those four workflows.

## Candidate shortlist

| Module | Candidate | Role | Current decision |
|---|---|---|---|
| Wallet foundation | Stellar Wallets Kit / Freighter | Connect wallet, detect network and request wallet-controlled signatures | Evaluate maintained APIs and browser support; integrate read-only first |
| RWA discovery | Stellar issuer/asset data and issuer official sources | Build a verified asset registry and Asset Passport | No single RWA API assumed; exact Stellar asset/contract IDs and issuer conditions must be verified per product |
| Yield | DeFindex | Yield vault/strategy integration | Strong initial candidate; current SCF Integration List includes it. Verify vaults, SDK/API, data and Testnet contracts |
| RWA yield | BENJI, Spiko/Amundi products including SAFO, USDY, WisdomTree products | Issuer-disclosed distribution/yield information | Discovery references only; exact Stellar token ID, terms, eligibility, access and current figures must be verified with issuer |
| Lending | Blend v2, Templar and other active Stellar lending pools | Read pool/reserve/rate/risk data, then possibly add transactions | Verify present protocol status, active pools, supported assets and live SCF eligibility from primary sources before selecting an integration |
| Voucher | Stellar Claimable Balances; Soroban escrow | Fund, share, claim, expire and refund | Compare both designs using a threat model and Testnet prototype before choosing |
| Later trading terminal | Soroswap Routing API; Stellar Broker; native Stellar path payments | Compare order-book and AMM liquidity, request routes, prepare swaps and execute with wallet approval | Evaluate venue coverage, route freshness, exact-in/exact-out behavior, split paths, API access/limits, Testnet support, fees and transaction simulation; choose one primary provider first |
| Later payments | BlindPay, Mercuryo, MoneyGram, Anchor Platform and other listed services | Fiat on/off-ramp or disbursement integration | Out of first release unless a real corridor, API access, KYB/compliance and commercial terms are verified |

## Important SCF Integration List correction

The current published SCF Integration List includes DeFindex under Stellar yield infrastructure. The list is re-evaluated and rotates; re-check it immediately before an application. Do not rely on cached copies or third-party posts to establish current eligibility.

Consequences:
- DeFindex is the strongest direct Integration Track candidate for NEXORA's first-release scope at this review.
- Confirm every selected building block against the live SCF page when preparing the application.
- A technically active protocol is not automatically an eligible SCF integration building block.
- Budget and application copy must not imply SDF endorsement or formal partnership.
- Payment vouchers implemented directly with Stellar primitives are not automatically equivalent to integrating an SCF-listed payments provider.

Official list: https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/integration-track/integration-list

The Integration List is community-recommended wayfinding, not an endorsement, partnership, warranty or guarantee of integration suitability.

## Recommended implementation sequence

### 1. Wallet and data foundation
Integrate Stellar Wallets Kit/Freighter for connect/disconnect, public account address and network detection. Read-only first; no secrets are ever collected.

### 2. RWA discovery
Build a curated issuer and asset registry from official issuer docs and Stellar onchain identifiers. Initial research references include Franklin Templeton BENJI, Spiko/Amundi SAFO products, Ondo USDY and WisdomTree digital funds. Verify each exact asset/contract identifier and the issuer's official distribution/access rules before publishing.

### 3. Yield
Prototype DeFindex read-only vault discovery and data normalization. Keep vault APY distinct from issuer-disclosed RWA distribution/coupon/yield. Include data timestamp, fees, incentives, strategy, withdrawal constraints and risk disclosures. Testnet deposit/withdraw only after confirming a supported Testnet vault.

### 4. Lending
Compare active Stellar lending pools. Verify each pool's contract, supported assets, rate calculations, available liquidity, oracle, collateral/liquidation parameters, backstop and current activity. Choose one integration for the initial Testnet workflow only after protocol-specific risk review.

### 5. Payment vouchers
Prototype two approaches:
- Native Claimable Balances for a specified claimant account and time predicates where this matches the intended UX.
- Soroban escrow for a one-time claim-link/QR experience with voucher IDs, claim authorization, expiry and refund state.

A native Claimable Balance is naturally claimant-account oriented; it should not be represented as an unrestricted bearer QR voucher. If the product needs an arbitrary recipient to claim from a bearer link, test a Soroban escrow design with an appropriately protected claim secret and strong replay/claim controls. Never put a wallet secret key in a voucher link.

### 6. Advanced trading terminal (later phase)
Compare Soroswap Routing API, Stellar Broker and native path payments. Soroswap describes aggregation across Soroban and classic Stellar liquidity; Stellar Broker describes routing across Soroban AMMs, classic AMMs and classic order books. Treat venue lists and performance statements as provider claims until independently tested. Begin with one primary route source, compare quotes against native path-payment options where applicable, and add fallback providers only when test results justify them. Exact-in/exact-out quotes, multi-hop and split routing must be tested on the provider's actual API and network.

Sources:
- Soroswap: https://soroswap.finance/
- Stellar Broker: https://stellar.broker/
- Stellar native path payments: https://developers.stellar.org/

## Provider diligence questions

1. Is the protocol actively maintained and operating on Stellar at the time of integration?
2. Which Testnet and Mainnet contracts/assets are supported?
3. Are SDKs, APIs, rate limits, fees, licensing or commercial approval required?
4. How are NAV, APY, liquidity and pool risk metrics calculated and refreshed?
5. What are the exact withdrawal, redemption, eligibility and transfer limitations?
6. Is there a developer support channel and can the provider review the planned use case?
7. What fallback and user messaging apply if an API, RPC or protocol stops responding?

Record documentation, contract addresses, proof-of-concept results and provider responses before claiming an integration or partnership.

## SCF implications

The Integration Track requires at least one building block from the live list and most of the requested budget to be associated with chosen integrations. DeFindex is a relevant current candidate. Other NEXORA first-release work may fit the Open Track better if the team can prove distinct user value and Stellar-native technical contribution. Decide the track only after checking all current rules and traction requirements.

References:
- Build Award: https://stellar.gitbook.io/scf-handbook/scf-awards/build-award
- Integration Track: https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/integration-track
- Integration List: https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/integration-track/integration-list

## Explicitly deferred

Advanced trading and DEX routing are a planned follow-on phase, not part of the first four-module release. Token launchpad, AI agent/MCP, autonomous execution, fiat payout and local-currency cash-out are also deferred.
