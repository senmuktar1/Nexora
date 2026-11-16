# NEXORA — Base Analytics feature parity and Stellar migration map

## Product direction

NEXORA is the Stellar-native successor to the Base Analytics product experience. The objective is to preserve the breadth of the reference product — its unified top-navigation shell, discovery-led home, trading, yield and lending, vouchers, launchpad, tokenized-asset research, portfolio, creator profile, alerts, analytics, AI agent and MCP surfaces, documentation and safety pages — while replacing EVM assumptions with verified Stellar and Soroban implementations.

**The reference ZIP is read-only.** It is used for product behavior, interaction patterns and visual layout. The original archive and any Base Analytics repository remain unchanged. NEXORA has its own codebase, data models, wallet integrations, API routes and deployment.

The UI should follow the reference screenshot and Base Analytics shell: horizontal top navigation; brand at left; Explore / Swap / Lend & Stake / Vouchers / Launch / Profile navigation; network, language/theme and wallet controls at right; guest-connect strip; large discovery hero with search and a featured panel; dense market and feature cards; consistent tables, drawers, tabs, modals and mobile navigation. NEXORA changes the brand palette to Emerald & Graphite, not the information hierarchy or interaction language.

## Feature-by-feature migration

| Reference feature area | NEXORA product surface | Stellar-native implementation / migration decision |
|---|---|---|
| Explore dashboard and market discovery | Explore | Asset search and issuer registry; ledger/market pulse; market overview, movers, watchlists, featured assets, token quick view, tables and discovery filters. Use Horizon plus a selected, verified indexer/market-data source. Every metric needs source, timestamp, network and stale-data state. |
| Token research/detail | Asset detail / Asset Passport | Identify a classic asset by **asset code + issuer account**, or a Soroban token by contract ID. Show authorization, transfer restrictions, issuer identity, documents, eligibility and price/NAV source separately. A ticker alone is never an asset identity. |
| Spot swap terminal | Swap | Compare classic Stellar order books, Soroban AMMs and a selected router. Support exact-in/exact-out quotes only where provider APIs permit. Display expected output, minimum received, price impact, slippage, fees, route, source and expiry. Use transaction simulation/preflight and explicit wallet signing. |
| Limit orders | Swap → Limit Orders | Use native classic Stellar offer operations where applicable; assess Soroban-based order functionality separately. Do not port the Solidity LimitOrderBook or Uniswap V3 adapter. |
| Lending and staking | Lend & Stake | Protocol comparison, reserve/pool tables, asset detail, gauges/rewards where applicable, yield finder, positions, action drawers, liquidation/risk panels and calculators. Evaluate DeFindex, Blend, Templar and other active Stellar markets. Only show live APY/APR/TVL/liquidity from validated sources. |
| Yield aggregation | Lend & Stake → Yield | DeFindex vault/strategy discovery and eligible issuer-reported RWA distributions. Keep vault APY, realized yield, incentives, coupon/distribution and NAV distinct. Include fees, strategy, lockups, withdrawals and risk. |
| Tokenized stocks and RWAs | Explore → Tokenized Assets | Port the discovery and research experience, not Base token contracts/tickers. List only products verifiably issued or supported on Stellar. Do not imply that AAPL, NVDA or any Base tokenized stock automatically exists or is transferable on Stellar. Respect issuer restrictions and jurisdiction-specific eligibility. |
| Vouchers and gift cards | Vouchers, Redeem, Share, Receipt | Preserve create wizard, recipient flow, card preview, QR/deep links, my vouchers, redeem status, receipt and expiry/refund UX. Compare native Claimable Balances with Soroban escrow. No bearer/non-custodial/recoverable claims until mechanism and threat model prove them. |
| Token launchpad | Launch | Preserve discover, launch wizard, identity, distribution, liquidity, review, success, token detail, market activity, announcements, calendar, creator tools and launched-token views. Rebuild issuance with Stellar classic assets or audited Soroban token-factory/contract patterns. Creator fees, vanity address and tokenomics features require explicit design and security validation; no EVM/B20 vanity assumptions. |
| Creator profile | Profile / Creator | Wallet-linked profile, public profile, creator activity and launch analytics. Authenticate using a Stellar-compatible signed challenge/session flow, not SIWE. Hosted Supabase may store user-authored profile metadata after schema and privacy review. |
| Portfolio and wallet analytics | Profile / Portfolio | Stellar wallet support, account balances, trustlines, Soroban token balances, offers, payments, transactions, history and asset exposure. Use public account data and a trusted indexer for richer history. Wallet secrets never touch NEXORA. |
| Wallet onboarding | Global Connect Wallet control | Multi-wallet Stellar support (Freighter, xBull, LOBSTR, Albedo, WalletConnect and other kit-supported providers), network mismatch checks and public-key display. Wallet adapter owns signing. No EIP-1193, Wagmi or Coinbase CDP. |
| Wallet and market intelligence | AI / Insights | Rebuild transfer and wallet analysis against Stellar operations, payments, offers, Soroban events and verified price sources. Explain classifications and uncertainty; do not copy Base/Alchemy heuristics as Stellar facts. |
| Watchlists and smart alerts | Explore / Profile / Alerts | User-defined asset, price, liquidity and wallet activity alerts. Needs a reliable data/indexing source, scheduled worker and hosted persistence. Alert values must carry source and timestamp. |
| AI agent and intent interface | AI Agent | Source-grounded read-only asset, market, portfolio and protocol research first. Transaction preparation may be added later but must stop for user review and wallet approval; the agent never receives private keys. |
| Model Context Protocol | `/api/mcp` / Developer docs | Preserve MCP transport and discoverable tools where technically reusable; rewrite tool schemas and handlers for Stellar asset IDs, Soroban contracts, Horizon queries, quote data and transaction previews. Start read-only. |
| Referral, rewards and daily actions | Profile / Rewards | Preserve only where a real, transparent Stellar-compatible reward source and anti-abuse model exists. Do not fabricate points, XP or token incentives. |
| Documents, help and legal | Docs / Help / Risk / Privacy / Terms | Rebuild Stellar-specific developer docs, eligibility/risk disclosures, privacy, terms, support, restricted access and incident information. Do not copy Base legal claims verbatim. |
| Push/Base App/Farcaster/Coinbase-specific surfaces | Reassess, do not port unchanged | Base App pinning, Farcaster wallet and notification APIs, Coinbase CDP/Base Account and Neynar identity are not Stellar primitives. Replace only if a clear Stellar-compatible user need and provider exist. |
| x402 payments | Later, optional | HTTP 402/payment middleware may be chain-neutral at the protocol layer, but EVM facilitator and payment settlement must be rebuilt/selected for Stellar. Not assumed in the first shipping milestone. |
| Solidity voucher and limit-order contracts | Soroban/native replacements | Do not copy Solidity, Foundry deployment artifacts, EVM calldata or Base contract addresses. Reimplement in Soroban or use native Stellar operations with tests, threat modelling and independent review. |

## Reference app surfaces to preserve

The archive includes these major user-facing routes and capabilities, which remain in the NEXORA product scope unless a Stellar-specific feasibility or legal issue is documented:

- Explore/home, token discovery, token detail, market intelligence, watchlists, market pulse and smart-money style research.
- Swap, swap-by-token, order-book/AMM liquidity and route comparison.
- Lend & Stake, earn/yield, lending market comparison, pool details, positions and risk/liquidation views.
- Voucher creation, voucher landing/cards, share, pay, redeem and receipt flows.
- Launchpad discovery, launch wizard, token detail/terminal, launch calendar, announcements and creator profiles.
- Tokenized stocks / RWA discovery, detail and lending-related research where Stellar products support it.
- Wallet analytics, portfolio, connected account, transaction/activity history, profile, watchlist, referrals and rewards.
- Alerts, AI/wallet analysis, MCP endpoint, docs, help, compliance, privacy, terms and risk disclosures.

## Current code status (initial parity pass)

- [x] NEXORA independent GitHub repository and Vercel project.
- [x] Reference archive inventoried: 1,293 files across App Router pages, components, API routes, libraries, contracts, tests, docs and public assets.
- [x] Replaced left-sidebar foundation layout with the reference-style horizontal navigation and discovery hero.
- [x] Added global network/theme controls and Stellar Wallets Kit connection foundation.
- [x] Added live read-only Horizon network status, issued-asset search and public account/balance/transaction endpoints.
- [x] Added initial Explore, Swap, Lend & Stake, Vouchers, Launch, Assets, Profile and AI/MCP product surfaces.
- [ ] Complete parity UI for all detail drawers, tables, charts, dialogs, launch wizard steps, creator pages, voucher share/redeem receipts and alert tools.
- [ ] Add selected Stellar indexer / market-data providers and production-quality server-side adapters.
- [ ] Complete each on-chain workflow on Testnet with acceptance tests and security review.
- [ ] Add hosted persistence for profiles, watchlists, alerts, launches and voucher records when schemas are approved.

## Non-negotiable migration controls

1. **No EVM residue in transaction paths:** no Wagmi, Viem, Ethers, SIWE, `0x` chain addresses, ERC-20 assumptions or copied Solidity contracts in NEXORA production flows.
2. **No invented live data:** rates, prices, volume, APY, TVL, holders and eligibility only appear when a working source is connected and timestamped.
3. **No misleading asset mapping:** exact asset code + issuer or Soroban contract ID; issuer identity and eligibility verified separately.
4. **Testnet first:** every transaction flow is developed and accepted on Testnet before Mainnet is enabled.
5. **Wallet ownership:** no secret keys or seed phrases; user wallet signs each transaction.
6. **Mainnet gate:** changing the network selector never enables production writes by itself.
7. **Feature completeness is staged, not silently removed:** if a feature cannot be ported as-is, document its Stellar replacement or the precise reason it is deferred.
