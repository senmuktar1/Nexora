# NEXORA architecture

## Product boundary

First release: **Tokenized RWA discovery, Yield aggregation, Lending/Borrowing and Payment Vouchers.**

The shared workflow is:

**Connect wallet → discover an eligible asset or financial opportunity → inspect issuer/protocol data and risks → review transaction conditions → sign in the wallet → verify the onchain result.**

Advanced trading, launchpad and AI/MCP are later-phase modules.

## Runtime boundaries
- `src/app`: Next.js App Router pages and server routes.
- `src/components`: shared UI and module-specific views.
- `src/lib/stellar`: typed network config and Stellar clients.
- `src/lib/assets`: issuer, asset and RWA registry; verification and provenance.
- `src/lib/yield`: DeFindex and issuer-yield adapters, normalization and freshness.
- `src/lib/lending`: Blend pool adapters, reserve/risk models and transaction preparation.
- `src/lib/vouchers`: voucher lifecycle model, claimable-balance/Soroban adapter and QR/deep-link generation.
- `src/lib/markets` and `src/lib/swaps` (later phase): order-book/AMM data, quote normalization, router adapters and transaction preparation.
- `src/lib/supabase`: hosted database client factories when persistence is needed.
- `docs`: product, security and integration decisions.

## Data trust model

Every external datum needs:
- source/provider and source URL;
- network and asset/protocol identifier;
- observed timestamp and retrieval timestamp;
- data type (onchain, issuer-reported, protocol-reported, third-party, estimated);
- units, calculation method and assumptions;
- verification/freshness state and failure behavior.

Do not compare issuer NAV, DEX spot price, vault APY and lending supply APY as equivalent measures.

## RWA registry and Asset Passport

Each record should distinguish:
1. classic Stellar asset code + issuer account, or Soroban contract address;
2. issuer identity and verified official domain;
3. issuer documents, underlying exposure, denomination and legal product type;
4. onchain authorization/transfer/freeze/clawback characteristics where available;
5. eligibility, supported jurisdictions, minimum, subscription/redemption and transfer rules from official sources;
6. market, NAV, distribution and yield information with source/timestamp;
7. missing data and unresolved verification items.

NEXORA is not an issuer, underwriter, custodian or transfer agent in the first release. Asset issuers control access and redemption according to their own documentation and onchain configuration.

## Yield aggregator

Adapters normalize:
- strategy/vault and underlying assets;
- supply/strategy/issuer yield type;
- current/estimated/realized/trailing/target periods;
- gross/net APY and compounding basis where available;
- incentive token component and valuation source;
- fees, withdrawal constraints, liquidity and risks;
- source freshness.

DeFindex is the initial aggregator candidate. RWA distribution/coupon/yield information must remain distinct from protocol vault APY. Stale or partial sources must be visibly labelled.

## Lending integration

Do not hard-code one protocol as the only possible lending source. Evaluate Blend and Templar markets using current activity, active pools, contract IDs, supported assets, Testnet availability, developer interfaces and protocol risk information. Blend v2 has published deployment documentation and remains a technical candidate. SCF Integration List entries can change and copied ecosystem references may be stale, so verify the live list directly at application time before claiming eligibility.

Pool and reserve models should include:
- contract IDs, pool admin and pool state;
- supported reserve and asset identifiers;
- utilization, liquidity, supply APY and borrow APR;
- collateral/liability factors, liquidation thresholds, oracle and backstop data where available;
- rewards/emissions separate from base interest;
- source timestamp and Testnet/Mainnet support.

Do not infer safety from a single numerical score. Surface pool configuration and liquidity constraints before transactions.

## Voucher architecture decision

Two designs require a Testnet technical and security comparison:

### Native Claimable Balances
Prefer for simple fixed-claimant transfers and supported time predicates where native protocol behavior satisfies the desired voucher UX. Consider constraints around claimant identity, links/QR handoff, expiry/refund and asset support.

### Soroban escrow contract
Consider when voucher IDs, explicit lifecycle state, claim authorization, custom expiry and refund logic are required. Requires contract tests, threat modelling, authorization review and independent security assessment before production.

In either design:
- creator funds from their wallet through explicit signing;
- claimant reviews asset, amount, issuer, conditions, expiry and network;
- claim is one-time and verifiable;
- expiry/refund behavior is explicit and testable;
- link secrets are not logged or stored in plaintext;
- NEXORA never collects seed phrases or secret keys.

Do not label the voucher "bearer", "non-custodial" or "recoverable" until the chosen implementation's control and recovery properties are verified.

## Advanced trading terminal (later phase)

The trading terminal builds on the shared wallet and transaction layer after the four-module first release:
- classic Stellar DEX order books and Soroban/classic AMM pool liquidity;
- market depth, trade history and charts with source timestamps;
- exact-in and exact-out quote interfaces;
- route comparison across a selected aggregator and native path-payment options where suitable;
- multi-hop or split routing only where the selected provider supports it;
- clear expected output, minimum received, price impact, slippage, protocol/provider/network fees, quote source and expiry;
- transaction preflight/simulation where supported, explicit wallet signing and onchain confirmation.

Evaluate Soroswap Routing API and Stellar Broker as potential primary route providers. Do not add both automatically; benchmark asset/venue coverage, quote freshness, reliability, Testnet support, fee model and failure handling. Stellar native PathPaymentStrictSend/StrictReceive can be used for applicable path-payment flows, but does not replace all Soroban AMM aggregation or router capabilities.

## Network and transaction safety

- Testnet is the default.
- Mainnet and Testnet have distinct RPC configuration, asset/protocol registries and contract IDs.
- Read-only data and transaction simulation/preflight precede writes.
- A transaction preview shows network, asset issuer/contract, amount, destination, fees, constraints, expected result and expiry where relevant.
- Signing happens only through a compatible wallet.
- Submitted transaction results are verified against the selected network.
- Mainnet writes require a production-readiness gate and explicit feature flag.

## Hosting and secrets

GitHub is source of truth; GitHub Actions validates; Vercel runs preview/production; Supabase provides hosted data, auth and storage when needed. Server-only credentials stay in Vercel server environment variables. No secrets or private keys in GitHub or client-side `NEXT_PUBLIC_` variables.

## Security and compliance boundary

- Do not bypass issuer eligibility or transfer authorization.
- Do not claim an RWA is regulated, audited, safe or redeemable without evidence.
- Do not promise a fiat payout without a provider, corridor, eligibility and working disbursement flow.
- No autonomous agent signing.
- Apply row-level security and least privilege to persisted user data.
- Voucher contracts require explicit threat modelling and security review.
