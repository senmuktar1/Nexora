# NEXORA product roadmap — UI parity first, Stellar integration second

## Product direction

NEXORA is a Stellar-native financial terminal with broad product and interaction parity with the user-provided Base Analytics reference application.

The reference screenshots and the supplied Base Analytics source archive are the UX specification. NEXORA should preserve the reference information architecture, screen hierarchy, interaction patterns, page density, drawers, dialogs, navigation and responsive behaviour. The intentional differences are NEXORA's real brand mark, Emerald & Graphite palette, Stellar/Soroban assets and verified Stellar data/protocols.

This roadmap follows the user's agreed sequence:

1. Build the complete UI and user journeys for every major screen first.
2. Compare the screens against the reference, file by file, at matching desktop and mobile sizes.
3. Only after the UI acceptance gate, integrate real Stellar data and transaction capabilities phase by phase.
4. Keep every spend, transfer, issuance, deposit, borrow, voucher funding/claim and other write action disabled until its own Testnet acceptance gate passes.

A screen is not complete just because it renders. It must have the reference layout, navigable states, working UI interactions, responsive behaviour and honest data/empty states.

---

# Track A — Complete UI/UX parity

## Phase 0 — Reference audit and shared design foundation

**Goal:** establish the source of truth and a repeatable implementation process.

- [x] Inspect the user-provided Base Analytics ZIP and map major app shell/page components.
- [x] Create a NEXORA implementation and parity map.
- [x] Establish Emerald & Graphite design tokens and dark/light theme.
- [x] Use NEXORA's existing `public/nexora-mark.svg`; do not replace it with a generated mark or Base branding.
- [x] Set up GitHub Actions and Vercel deployment from `main`.
- [x] Build a component-by-component reference-to-NEXORA file map for all screens (`docs/UI-PARITY-MAP.md`; exact source component names were checked against the supplied archive).
- [ ] Capture and compare agreed reference viewports: 390px, 640px, 768px, 1024px and 1440px.

**Acceptance:** every screen has an identified Base reference component, a NEXORA target file, a list of interactions and a responsive acceptance checklist.

## Phase 1 — Shared app shell and navigation

**Reference areas:** Base `AppHeader`, `AppShell`, `MobileBottomNav`, `CommandPalette` and guest/connect UI.

**NEXORA files:** `src/components/nexora/NexoraApp.tsx`, `src/app/globals.css`, wallet shell components and `public/nexora-mark.svg`.

- [x] Desktop horizontal navigation and compact header.
- [x] NEXORA mark and Emerald/Graphite theme.
- [x] Guest/connect state, wallet/account menu, theme and network controls.
- [x] Mobile six-item bottom navigation and mobile search entry.
- [ ] Compare header spacing, button sizing, banners, search placement and sticky behaviour against the reference.
- [ ] Verify safe-area insets, touch targets, menu dismissal, keyboard behaviour and scroll behaviour at all acceptance widths.

**Acceptance:** desktop and mobile shell match the reference structure and behave consistently on every route. No hamburger menu is added where the reference uses compact inline utilities and bottom navigation.

## Phase 2 — Overview / Explore / Token Explorer

**Reference areas:** Explore hero, featured spotlight, Base Markets, market signals/key movers, Trending on Base and Token Explorer.

**NEXORA files:** `src/components/nexora/explore/ExploreExperience.tsx`, `src/components/nexora/NexoraApp.tsx`, `src/app/globals.css`.

- [x] First UI pass: hero/search, featured panel, live XLM/USDC snapshot, signal cards, discovery tabs, asset explorer, local watchlist and issuer quick-view.
- [ ] Match reference hierarchy and spacing for the markets KPI strip and chart.
- [ ] Add the complete discovery category control set, including all-token and tokenized-asset groupings supported by the Stellar asset registry.
- [ ] Match filter rails: Trending, New, Top Gainers, Losers, Volume and watchlist states where corresponding data is available.
- [ ] Match quick filters such as issuer/contract verification and liquidity thresholds; explain filters that cannot yet be evaluated from available data.
- [x] Asset quick view now includes a Horizon source-availability checklist for exact identity, holder/supply fields and issuer authorization flags. Missing fields are explicitly unavailable; this is not a safety score, issuer audit or transferability guarantee.
- [x] Issuer revocability filter added using Horizon `auth_revocable`, with distinct revocable/non-revocable states; active filter count and reset action include it. Unreported authorization values are not inferred.
- [ ] Implement the reference list/grid view switch and token-card density.
- [ ] Match token card contents: logo/asset identity, issuer verification state, price/change, mini chart when data exists, market cap/volume/liquidity only when sourced, issuer/address copy, watchlist, action menu and Swap navigation.
- [ ] Keep horizontal swipe rails and compact card layout on mobile.

**Acceptance:** overview and explorer controls work, every number has a source/freshness label, and unsupported market-wide rankings or valuations are shown as unavailable rather than invented.

## Phase 3 — Swap terminal

**Reference areas:** portfolio summary, sell/receive trade card, asset picker, swap direction control, connect-wallet CTA, fee/routing disclosure and popular assets.

**NEXORA files:** `src/components/nexora/swap/SwapExperience.tsx`, `src/components/nexora/NexoraApp.tsx`, `src/app/globals.css`.

- [x] First UI pass: Market/Orders/Recurring navigation, editable amount, issuer-aware picker, pair flip, portfolio drawer, balance percentages, slippage and route settings preview.
- [x] Token picker and portfolio drawer now lock background scrolling, focus the active dialog, trap keyboard focus, close on Escape and restore prior focus. Asset search now has an abort timeout and explicit error state; query changes clear stale loading state.
- [x] Swap reader preview now checks the connected account's classic-asset trustline and issuer authorization before presenting the receive path; it distinguishes missing trustline from issuer-not-authorized states and waits for a successful account read before showing either warning.
- [x] Stellar asset selector now has All assets, My balances and Recent tabs. Recent selections are stored locally (no wallet secrets); balance assets come from the connected account's Horizon response, and asset search is scoped to the All assets tab with code filtering.
- [x] Portfolio drawer now distinguishes wallet-disconnected, loading, read-error, empty and populated balance states.
- [x] Swap portfolio summary now reports the native XLM balance when returned by Horizon, without inventing USD valuation.
- [x] Quote/route disclosures can be expanded and collapsed; unavailable quote, impact and fee fields remain explicitly unavailable.
- [x] Mobile Swap layout now uses a single full-width trade column, tighter paired panels and narrow-screen sizing down to 360px.
- [x] Swap deep links validate the supplied asset code + issuer against the currently selected network's Horizon asset records before selecting the receive asset.
- [x] Deep-link validation now queries Horizon using both the asset code and exact issuer, avoiding false negatives when the same ticker has more than 20 issuer records.
- [x] Account balance reads are aborted on address/network changes; balances are tagged to their source network and withheld from picker, portfolio, trustline and insufficient-balance states until the current network read succeeds.
- [x] Picker rows distinguish Horizon-listed search records from unverified/manual issued-asset entries and show issuer plus available account-count/authorization metadata. A Horizon record is an identity lookup, not an endorsement or security audit.
- [x] Token picker now displays the currently selected pay/receive asset with code + issuer, marks the matching result as selected with accessible pressed state, and exposes keyboard focus styling.
- [x] Portfolio drawer withholds balances until the current-network account read completes, matching the network-scoped picker and trustline guards.
- [x] Asset search and wallet-balance read failures both expose explicit retry actions; retry uses the same cancellable, network-scoped request path.
- [x] Verified production Horizon asset lookup returns an exact single USDC code + issuer match on both Testnet and Mainnet. Explore quick-view links carry both `buyCode` and `buyIssuer` into Swap.
- [ ] Match the reference mobile composition and widths: portfolio summary above the trade card, paired amount panels, centered flip control, primary wallet/action button, fee/provider disclosure and popular asset chips.
- [ ] Match token selection states, selected token details, verified asset markers and asset search results.
- [ ] Add reference-style market/order controls and quote-detail expand/collapse behaviour where present in the supplied source.
- [ ] Align error, insufficient balance, no trustline, unavailable quote and wallet-disconnected states.
- [ ] Verify deep links from asset cards open Swap with the correct asset code AND issuer.

**Acceptance:** all non-transactional swap controls work. Quote values remain unavailable until a real route is connected. Swap/order/recurring submission stays disabled in reader mode.

## Phase 4 — Lend & Stake

**Reference areas:** lending overview, market summary, positions/health, liquidation guard, top-yield spotlight, Tokenized Stocks, Staking & Vaults, Yield Scanner, Compare Protocols, search and dense market table.

**NEXORA target:** extract a dedicated `src/components/nexora/lending/LendingExperience.tsx`; keep only route composition in `NexoraApp.tsx`; style in `src/app/globals.css`.

- [ ] Rebuild the page to match the reference screenshot; the current generic protocol-card page is not accepted as final.
- [ ] Add top metric panels: best supply APY, lowest borrow APR, total liquidity and verified market count.
- [ ] Add Your Positions & Health with wallet connect state and a liquidation-health panel.
- [ ] Add a featured yield/protocol spotlight with source and verification label; use unavailable state until live data exists.
- [ ] Add segmented sections for tokenized assets, staking/vaults, yield scanner and protocol comparison.
- [ ] Add asset search, market-type filters, protocol filters and category/sector filters as appropriate to verified Stellar markets.
- [ ] Build a dense comparison table with asset identity, price, best supply APY, best borrow APR, total liquidity, supported protocols, wallet balance and Compare action.
- [ ] Build responsive table behaviour for mobile (horizontal scroll/card transformation only where the reference does so).
- [x] Add comparison/detail drawers and empty states for asset and protocol review.
- [x] Lending drawers support Escape-to-close, focus trapping, focus restoration and background scroll locking.
- [x] Mobile drawers use full-width safe-area-aware layout with visible keyboard focus styling.
- [x] Protocol detail drawers now show active network, integration/adapter status, protocol-specific verification gates and the next adapter milestone for DeFindex, Blend and Soroswap. Candidate listings remain explicitly unverified.
- [x] Added the official Blend SDK and a read-only Soroban endpoint that checks candidate pool WASM hashes and backstop identities against Blend deployment manifests before exposing V2 reserve data.
- [x] Added the documented mainnet Fixed V2.1 pool candidate and distinguish V2 from V2.1 using its verified backstop identity.
- [x] Connected Blend pool/reserve reads to protocol comparison: current supply APY estimates, borrow APR, utilization, supplied/borrowed amounts, pool oracle and ledger provenance are displayed only when live RPC reads succeed. USD TVL remains unavailable without verified oracle valuation.
- [x] Extended Blend reserve inspection with SDK oracle prices and oracle ledger provenance, reserve-vs-token decimal consistency, supplied/borrowed oracle-unit values, collateral factor and liability factor. The interface explicitly avoids labeling oracle units as USD without verified denomination.
- [x] Added a read-only Blend wallet-position endpoint using the official SDK to load each verified pool's user ledger entries, oracle prices and position estimates; the endpoint returns per-reserve supply, collateral and liabilities plus pool-level effective collateral, effective liabilities, borrow limit, net APY and oracle ledger.
- [x] Position reads now compare oracle ledger against the latest RPC ledger and latest reserve ledger, returning exact ledger lag and explicit behind-head/behind-reserve flags. The liquidation-health panel surfaces these values and warns when the oracle trails sampled pool state; no arbitrary stale threshold is presented as protocol policy.
- [x] Live production Testnet Blend endpoint returned four enabled reserves and token/reserve decimals matched for all four in the sampled response. The sampled pool oracle read was unavailable, so oracle prices and oracle-unit valuations correctly remained null rather than being fabricated.
- [x] Blend market API now preserves the oracle read exception and returns its diagnostic message for troubleshooting; the lending panel displays that detail. Latest diagnostic and oracle-freshness UI commits are pending a new deployment.
- [x] Connected the lending workspace to the position reader with explicit loading/error/retry states, per-pool position cards and collateral-capacity warnings. Ordinary Horizon wallet balances are never treated as lending positions.
- [x] Added a collateral stress what-if model: selected percentage decline is applied uniformly to verified effective collateral oracle values; effective liabilities remain unchanged; results show stressed borrow-limit ratio and remaining collateral capacity per pool. The model flags incomplete oracle/risk-factor coverage and is explicitly not represented as the protocol liquidation engine.
- [x] Lending account reads are cancelled on wallet/network changes and scoped to the active network; stale-network balances are withheld from position summaries and asset balance cells.
- [x] Lending account read errors expose a retry action; asset search aborts stale requests and immediately hides previous results while a new query/network is loading.

**Acceptance:** the complete reference UX is visible, but APY/APR/TVL and liquidation metrics are never fabricated. Supply, borrow, repay, withdraw, stake and unstake actions stay disabled.

## Phase 5 — Payment Vouchers

**Reference areas:** voucher landing, create, card preview, share success, QR/deep link, My Vouchers, redeem/reveal and receipt pages.

**NEXORA files:** `src/components/nexora/vouchers/VouchersExperience.tsx` plus dedicated route/page components where needed.

- [x] First pass: create/redeem/my vouchers navigation and guided creator flow.
- [x] Voucher amount validation parses exact 7-decimal Stellar stroop precision using integer arithmetic and validates the decimal separator; batch splitting must divide evenly at the stroop level, and invalid/over-precision/zero values block review. One Link draft validates positive amount precision as well. This is local UI validation only; it does not fund or create vouchers. batch splitting must divide evenly at the stroop level, and invalid/over-precision/zero values block review. One Link draft validates positive amount precision as well. This is local UI validation only; it does not fund or create vouchers.

- [ ] Match all reference steps, card states, QR/share modal, copy/share actions, My Vouchers list, redeem states and receipts.
- [ ] Add mobile card sizing, share-sheet behaviour and recipient journey.
- [ ] Add unavailable/expired/already-claimed/invalid-link states.

**Acceptance:** all voucher screens and user journeys are complete as UI. Funding, claim, refund and transfer remain disabled until a reviewed Stellar escrow/claim design is implemented.

## Phase 6 — Launchpad and creator launch journey

**Reference areas:** launch discovery, launch cards, calendar, announcements, token detail/terminal, creator pages and multi-step launch wizard.

**NEXORA files:** `src/components/nexora/launch/LaunchExperience.tsx`, dedicated launch detail/creator components and `src/app/globals.css`.

- [x] First pass: discovery/create/my launches/calendar navigation and guided issuer setup preview.
- [x] Launch supply now uses exact integer base-unit parsing at the selected display precision; rejects zero, excess decimal places and malformed input. Classic Stellar issuance also enforces the signed 64-bit stroop ceiling before allowing the review step. This is a client-side configuration check, not an issuance simulation or permission to submit a transaction.

- [ ] Match launch discovery cards, filters, announcements and calendar.
- [ ] Add token detail and market terminal view.
- [ ] Complete identity, asset standard, tokenomics/supply, distribution, issuer controls, review and success steps.
- [ ] Add creator page, launch history, analytics and revenue-share presentation states.
- [ ] Keep classic Stellar asset issuance and Soroban token-factory paths clearly distinct.

**Acceptance:** complete launch and creator UI exists. Asset issuance, distribution and liquidity creation remain disabled until the Stellar implementation and issuer-key controls are reviewed.

## Phase 7 — Profile, portfolio and creator dashboard

**Reference areas:** wallet portfolio, token holdings, history, charts, watchlist, alerts, settings, creator profile and earnings.

**NEXORA target:** dedicated `src/components/nexora/profile/ProfileExperience.tsx` and creator subcomponents; route composition in `NexoraApp.tsx`.

- [ ] Match profile tabs, portfolio summary, asset balances, transaction activity and token detail states.
- [ ] Add reference-style charts/allocations only where reliable price history exists.
- [ ] Add watchlists, settings and alert management UI.
- [ ] Add creator overview, launched assets, volume, fee/revenue history and payout states.
- [ ] Label actual vs estimated earnings; never portray an off-chain estimate as a settled on-chain payment.

**Acceptance:** profile and creator views are fully navigable and accurately separate public on-chain data from user-authored data and estimated values.

## Phase 8 — Remaining product surfaces and UI acceptance

- [ ] Complete token detail, public share/pay/receipt, docs, help, legal and risk pages.
- [ ] Complete cross-page navigation, dialogs, menus, drawers, tooltips and responsive overflow.
- [ ] Run viewport comparison for every major page at 390px, 640px, 768px, 1024px and 1440px.
- [ ] Verify touch targets, keyboard operation, focus states, loading/error/empty states and accessibility labels.
- [ ] Check dark and light themes.
- [ ] Record any visual differences that cannot be reproduced and get product approval for the chain-specific alternative.

**UI acceptance gate:** do not declare Track A complete until Overview, Swap, Lend & Stake, Vouchers, Launch and Profile have been compared screen-for-screen against their Base reference counterparts. Then begin the full transaction integrations below.

---

# Track B — Stellar data and functionality

## Phase 9 — Stellar wallet, network and data foundation

Track B has advanced some Phase 12 lending work in parallel, but this foundational phase is not yet fully accepted. Complete the remaining wallet and data-source validation before enabling any financial writes.

- [x] Integrated Stellar Wallets Kit multi-wallet connection with lazy-loaded default wallet modules, connect and disconnect flows.
- [x] Persisted the selected app network and restored the Wallets Kit's existing public-address session on reload; added state-update and disconnect event subscriptions. Only public wallet identity/session metadata is retained; no secret keys are handled by NEXORA.
- [x] Added wallet-network mismatch detection for wallet modules that expose their active network, and surfaced a clear warning in the app shell.
- [x] Added read-only Horizon account endpoint for account identity, sequence, balances/trustline entries and the latest ten transactions.
- [x] Added read-only Soroban contract reads through the Blend SDK and direct RPC verification routes.
- [x] Preserved canonical asset identity in the integrations: classic assets use code plus issuer; Soroban assets use contract IDs.
- [ ] Manually validate wallet connection, disconnect, account changes and network mismatch on supported desktop and mobile wallets, including WalletConnect and hardware-wallet paths.
- [x] Added a read-only Horizon account-offers read with canonical selling/buying asset identity, exact price ratio, amount, modification ledger/time and paging token; an unavailable offer response is reported separately from the account read.
- [ ] Verify Horizon offer reads against live accounts with and without open offers, and add cursor-based pagination where product screens need more than the first 100 records.
- [ ] Select a broad Stellar market/indexing source for historical prices, volume and reliable token coverage; Horizon asset search and protocol SDK reads are not a substitute for a market indexer.
- [ ] Define caching, pagination, rate limits, source provenance and stale-data policies across the chosen sources.
- [ ] Confirm server-side persistence boundaries for user features; wallet secrets must never be stored.

**Acceptance:** reliable read-only Testnet and Mainnet data, with clear network, issuer/contract identity, source and freshness metadata.

Track B sequencing: Phase 9 is partially implemented but still needs wallet/device QA and a market data source. Phase 10 (market intelligence) and Phase 11 (swap execution) remain unaccepted. Phase 12 lending preflight is being developed in parallel; do not enable lending writes until earlier dependencies and all protocol-specific safety gates are complete.

## Phase 10 — Overview market intelligence integration

Provider research (not yet selected):
- StellarExpert is the strongest established Stellar-native indexer candidate: its API covers accounts, classic assets, Soroban contracts, DEX markets, liquidity pools and historical data. Testnet endpoints are free; Mainnet endpoint costs vary by compute units and the production plan/licensing needs to be budgeted. https://stellar.expert/api-docs · https://stellar.expert/pricing
- Stellar Index offers a broad asset/market/price API and a free public tier, but its API is pre-v1 and its status page has recently reported an unknown status. Require live health, freshness, coverage and commercial-terms checks before selecting it as a production dependency. https://stellarindex.io/docs/ · https://stellarindex.io/status/ · https://stellarindex.io/terms/
- CoinGecko can supplement global USD reference pricing and history for assets it lists, but cannot replace a complete Stellar-native asset/market index. https://www.coingecko.com/en/api

- [x] Integrated StellarExpert's public top-50 asset directory through a server-side provider route for the selected network. The route supports the documented list response envelope and fully qualified classic-asset identifiers, validates the network, times out safely and returns provider/source/retrieval metadata. The Explore discovery panel shows provider directory order and only optional fields actually returned; it does not label this order as market-cap, volume or performance ranking.
- [x] Added a server-side StellarExpert asset-supply endpoint and surfaced the returned supply in the asset quick view. The route validates classic asset codes and issuer accounts, selects the correct Alphanum4/Alphanum12 asset type, converts integer stroops to 7-decimal units, and handles missing records, rate limits and provider errors.
- [x] Added a server-side StellarExpert ticker proxy for Testnet/Mainnet. It preserves the provider payload with source and retrieval metadata; the UI does not yet interpret ticker fields until the live response shape is validated.
- [ ] Validate live API responses, record shapes and top-50 coverage on both Mainnet and Testnet; verify supply and ticker payloads and test rate-limit/outage behaviour. Live requests could not be executed from the current build environment, so the parser and routes are implemented but not runtime-verified against the provider here.
- [ ] Select and validate a paid market-data plan or a second provider for broad Mainnet price history, comparable volume, liquidity and gainers/movers. StellarExpert documents the top-50 asset list, asset supply and ticker endpoints as free on Mainnet; other Mainnet data endpoints are paid. Its published Navigator plan starts at $40/month, with higher tiers for increased limits. Confirm budget and licensing before enabling paid endpoints.
- [ ] Populate token lists, movers, liquidity filters, verification and charts from comparable source data.
- [ ] Integrate issuer metadata and tokenized RWA directory with eligibility/disclosure links.
- [ ] Add watchlist persistence and market-alert data.

**Acceptance:** all displayed metrics are real, source-labelled and timestamped; no fake market cap, volume, liquidity, holder count or ranking.

## Phase 11 — Swap and trading integration

- [ ] Benchmark native Stellar SDEX/path-payment routes and supported Soroban AMM aggregators.
- [ ] Select route providers based on coverage, quote freshness, reliability, Testnet support, cost and failure handling.
- [ ] Implement quote, route comparison, slippage, minimum received, price impact, quote expiry and fee breakdown.
- [ ] Build and simulate/preflight transactions where supported.
- [ ] Execute on Testnet with explicit wallet signature; confirm settlement and failure/retry states.
- [ ] Add native Stellar offers for supported limit-order use cases.
- [ ] Design recurring execution as a separate, permissioned service; do not imply it exists from a schedule form alone.
- [ ] Add NEXORA protocol fees only after disclosure, payout routing and reconciliation are verified.

**Acceptance:** a supported Testnet trade completes quote → preview → wallet signature → settlement → history. No Mainnet execution before release approval.

## Phase 12 — Yield and lending integration

- [x] Connected the public DeFindex vault discovery and strategy endpoints for the selected Stellar network; displayed protocol-reported APY and raw underlying asset amounts with explicit source/freshness and no invented USD TVL.
- [x] Added a server-side read-only DeFindex vault inspection endpoint with Stellar contract-address format validation; the API key, when configured, stays server-side.
- [x] Added a per-vault metadata inspector for reported name, share symbol, APY, vault fee, underlying asset contracts, strategy status and administrative roles. The panel labels API-reported information and does not claim independent bytecode, audit or withdrawal verification.
- [x] Added a direct Soroban read-only verification route: resolves the contract spec, confirms expected DeFindex vault methods, reads vault name/symbol/assets/managed funds/fees and attempts on-chain decimals reads for each underlying asset. Raw integer amounts are preserved as strings.
- [x] Added an in-app verification panel with Soroban ledger freshness, method/check results, underlying contract addresses, decimals verification, strategy pause status and managed-fund raw units.
- [ ] Complete manual contract-by-contract verification of share-token identity, withdrawal constraints, strategy permissions, admin controls and audit scope before enabling user position or transaction flows.
- [ ] Validate active lending markets such as Blend and any other supported protocol by checking contracts, pool status, oracles, risk parameters and Testnet availability.
- [ ] Normalize supply APY, borrow APR, incentives, utilization, TVL and withdrawal constraints without mixing definitions.
- [ ] Add wallet positions, health and liquidation warnings from verified protocol data.
- [x] Expanded Blend Testnet preflight with read-only SEP-41 token balance simulation for supply/repay, actual Blend user positions, non-collateralized withdrawable supply, outstanding liability checks, reserve available-liquidity checks and oracle-backed effective collateral headroom for borrowing. Collateral withdrawal is deliberately excluded until a distinct health-factor-checked path exists.
- [x] Preflight result now surfaces raw wallet/position/liquidity values and oracle-unit borrow headroom. It remains read-only; transaction preparation, simulation, signing and settlement gates stay blocked.
- [ ] Re-run the production build after the latest preflight and wallet-session changes; the first preflight build surfaced two TypeScript issues, which have been corrected in a follow-up commit but have not yet passed a fresh build.
- [ ] Add protocol transaction construction and Soroban simulation with fee/resource review, then verify the exact wallet kit signing interface and Testnet settlement using explicit user approval.

**Acceptance:** one supported Testnet vault or lending pool has verified read data and a bounded end-to-end position workflow.

## Phase 13 — Voucher protocol integration

- [ ] Choose and threat-model Stellar claimable balances or Soroban escrow.
- [ ] Specify claimant authorization, secret/link handling, replay protection, expiry, refund and recovery.
- [ ] Implement create/fund/share/claim/refund lifecycle with event history.
- [ ] Review contract and recipient experience before Mainnet.

**Acceptance:** a voucher can be created and claimed once on Testnet, with correct expired/already-claimed/refund states.

## Phase 14 — Launchpad and creator-economy integration

- [ ] Finalize classic asset issuance vs Soroban token-factory architecture per launch product.
- [ ] Implement issuer controls, metadata, supply/distribution and wallet-signed issuance on Testnet.
- [ ] Integrate supported liquidity venues only after route review.
- [ ] Design platform treasury and creator fee-sharing with visible fees and verifiable on-chain routing.
- [ ] Build an auditable fee ledger that reconciles only to actual successful transaction transfers.

**Acceptance:** launch and any revenue share are demonstrated on Testnet with clear issuer ownership, fee disclosure and payout evidence. No hidden fees and no unsupported creator earnings claims.

## Phase 15 — Profile, persistence and notifications

- [ ] Add authenticated profile settings and user-authored watchlists/alerts with appropriate access control.
- [ ] Add reliable portfolio valuation only when price/indexer coverage is adequate.
- [ ] Reconcile creator earnings and payout history against successful on-chain fee transfers.
- [ ] Add notification delivery and user controls.

**Acceptance:** user data is isolated, public account data remains public, and financial history is traceable.

## Phase 16 — AI agent and MCP

- [ ] Implement sourced read-only tools for asset, market, swap quote, lending risk and portfolio analysis.
- [ ] Add provenance, timestamps, uncertainty and stale-data safeguards to agent outputs.
- [ ] Expose read-only MCP tools with schemas, allowlists, rate limits and audit logs.
- [ ] Add transaction preparation only as a separate permissioned step; the user's wallet signs every transaction.

**Acceptance:** the agent never receives or stores wallet secrets and cannot execute a financial action without explicit wallet approval.

## Phase 17 — Mainnet readiness and rollout

- [ ] Separate Testnet and Mainnet endpoints, issuer registries, pool IDs, contracts and configuration.
- [ ] Review custom contracts and transaction flows; obtain independent security review where appropriate.
- [ ] Verify protocol/provider permissions, issuer terms, legal restrictions and operational support.
- [ ] Configure monitoring, incident response, rate limits and recovery processes.
- [ ] Perform Mainnet read-only verification and limited canary transactions.
- [ ] Enable production writes only after the relevant written readiness gate is approved.

**Acceptance:** changing the network selector alone never enables a write action. Each Mainnet feature needs its own security, provider, operational and legal approval.

---

## File-by-file engineering workflow

For every phase and page:

1. Inspect the corresponding Base source component(s) and the current NEXORA files before editing.
2. Identify the exact target files and explain the change set.
3. Implement one page/component batch at a time; keep shared shell and unrelated pages stable.
4. Commit to GitHub and let CI/Vercel validate the change.
5. Compare the deployed screen against the supplied screenshot at the same viewport.
6. Fix layout, spacing, responsive behaviour and interactions before marking the screen accepted.
7. Only then move to the next page or integration phase.

Do not send the maintainer local terminal or IDE steps. GitHub is the source of truth and Vercel is the deployment/preview environment.

## Current implementation snapshot — 13 November 2026

- Shared app shell: NEXORA's actual `public/nexora-mark.svg`, six-item desktop navigation, mobile header/search/bottom navigation, and grouped Products / Finance / Legal / Resources footer hierarchy are implemented; detailed responsive visual acceptance remains open.
- Overview: expanded reader-mode pass in `explore/ExploreExperience.tsx`; live XLM/USDC snapshot with bounded Horizon requests, hero autocomplete/recent searches, Discovery Hub, RWA NAV Tracker / Smart Money Radar / Smarter Alerts, and Token Explorer categories, authorization filters and table/card views. Asset quick view now follows the reference Overview / Live Chart / Quick Swap pattern as Overview / Market / Quick Swap, while keeping issuer controls and full code-plus-issuer identity visible in Overview; the Market tab explicitly avoids implying asset-specific quotes, and Quick Swap is a preview with a deep link rather than a fabricated quote. Drawer focus trapping, Escape dismissal and focus restoration are implemented. Explorer filters now include issuer authorization and minimum-holder thresholds, active-filter count and reset; the five-card signal row includes both bid- and ask-side depth. The hero RWA quick-access shortcut now opens the RWA references tab directly. Detailed viewport-by-viewport visual acceptance and the Soroban contract index remain open.
- Swap: first reader-mode pass in `swap/SwapExperience.tsx`; Market / Orders / Recurring, asset picker, portfolio drawer and settings are present; exact mobile card composition and actual quotes remain open.
- Lend & Stake: first reference-structured pass in `lending/LendingExperience.tsx`; KPI row, positions/health, yield spotlight, four tabs and market table are present. The supplied Base archive's `docs/qa-screenshots/Desktop__lend.png` and `Pixel-7__lend.png` were inspected directly. A parity patch now orders the page as header/KPIs → reference disclaimer → view navigation → positions/health → yield spotlight, and the Verified Markets KPI counts verified pools rather than reserve rows. The latest parity pass adds separate market-category and action navigation tiers, explicit read-only Supply/Borrow notices, and a vault shortcut for Stake & Vaults. The generic Horizon asset search remains labelled Stellar Assets rather than being misrepresented as tokenized stocks. The market table now carries semantic field labels and an Inspect Asset action; on narrow screens (≤600px) rows become labelled two-column cards rather than forcing an 850px horizontal table. Market filters now show an active-filter count and provide a one-click reset. This is responsive implementation work, not visual acceptance: compare the five target widths, test filter combinations, and verify the full source/empty/error states before marking the lending surface accepted. Blend reads use the Blend SDK with pool WASM/backstop allowlisting and on-chain position/oracle data. Position oracle requests are now scoped to the wallet's actual supply, collateral and liability reserves, avoiding failures caused solely by unrelated pool assets; SDK risk math is checked against the official implementation and its unit tests: effective collateral applies the reserve collateral factor, effective liabilities apply the inverse liability factor, borrow capacity is their difference, and the borrow-limit ratio is effective liabilities divided by effective collateral. This ratio is not presented as an independently verified liquidation price or a guarantee of protocol liquidation timing. The reserve reader now isolates Blend oracle reads per asset rather than failing the entire pool when one feed fails; each reserve reports its own oracle price, ledger and read error, alongside supplied/borrowed oracle-unit values, reserve-vs-token decimal consistency, collateral factor and liability factor; the lending panel displays these with explicit non-USD denomination language. DeFindex public discovery, server-side API metadata inspection and a new direct Soroban read-only verifier are implemented in GitHub; the verifier checks contract spec/methods, reads name/symbol/assets/managed funds/fees and attempts underlying asset decimal reads, displaying raw integer units and ledger freshness. The Soroban verifier now preserves successful reads when individual vault methods fail, reports field-level errors and distinguishes contract-spec discovery from full method verification. The protocol comparison cards now consume actual Blend pool/reserve/oracle reads and DeFindex vault/strategy discovery counts, include sampled-ledger and retrieval freshness, and expose per-protocol evidence inside the review drawer. Individual Blend reserve rows now open a read-only inspection drawer.     The Vercel production build log exposed TypeScript failures caused by BigInt literal syntax under the repository's ES2017 target, plus a missing ArrowLeftRight import and optional vault-address narrowing in the DeFindex comparison button. Replaced BigInt literal syntax with the BigInt() constructor (the target remains unchanged), corrected raw integer parsing, imported the missing icon and narrowed the vault address before comparison updates. Source-level checks confirm the reported error patterns are addressed; a fresh production TypeScript/build run is still required. The verifier now conditionally reads share-accounting values only for method names present in the deployed contract specification, including total supply and share decimals where exposed. The inspector displays those raw results alongside the fee response and labels both as evidence requiring contract-specific interpretation. It does not assume ERC-4626 semantics, infer share decimals from underlying assets, or calculate an APY/share price from incomplete fields. The DeFindex Soroban verifier now reconciles managed-fund raw integer values per underlying asset: sum of strategy allocation amounts versus reported invested amount, and idle plus invested versus reported total. It returns raw-unit deltas and match/mismatch/unverifiable states; it does not normalize decimals or infer USD value. The UI exposes the arithmetic and explicitly states that matches do not prove liquidity, withdrawal availability or economic correctness. This is a data-consistency check, not an audit or transaction gate.  The vault inspector now includes a Testnet transaction-readiness checklist: contract existence, expected method discovery and underlying decimals evidence are displayed separately from argument-schema, authorization, withdrawal-liquidity, simulation, fee-review and wallet-settlement gates. Unverified gates remain blocked; the panel does not prepare or submit transactions. The direct Soroban inspector now groups contract-spec method names into share-accounting, deposit, withdrawal and permission/role capabilities, with explicit UI wording that discovered names are not proof of argument schemas, authorization behavior, liquidity, queue/lock conditions or successful execution. This is capability discovery only; no speculative method calls are made. The DeFindex vault directory now supports selecting up to two discovered vaults for side-by-side review, including reported APY, share symbol, contract address, underlying record counts and raw managed-fund amounts. The comparison explicitly warns that APY periods may differ and raw token quantities are not normalized or USD-valued; it does not present them as comparable TVL or investment recommendations. Users can remove/replace selections, clear the comparison, and open either vault's existing API metadata plus direct Soroban verification panel. Responsive single-column comparison is implemented. This remains discovery-level comparison; vault-specific withdrawal constraints and strategy safety require contract-level evidence. with SDK supply APY estimate, borrow APR, utilization, supplied/borrowed amounts, collateral/liability factors, oracle price and ledger, reserve/token decimal comparison, and pool/asset/oracle contract identities. Oracle denomination is explicitly not assumed to be USD; supply/borrow/withdraw remain disabled. Responsive drawer metadata layout is included. Visual acceptance and source freshness/error-state checks remain open. Soroswap remains explicitly research-only with no invented pool, liquidity or quote data. This is source-backed comparison UI, not protocol acceptance or transaction readiness. Latest verifier/UI commits remain awaiting deployment because Vercel reports a project build-rate limit. Exact table/filter and mobile parity remains open.
- Launch: five-stage reader-mode flow in `launch/LaunchExperience.tsx`; includes local logo upload preview, identity/social links, Classic / Soroban / RWA paths, supply presets, allocations, vesting, liquidity planning, issuer controls and readiness review. EVM launch mechanics are not represented as Stellar functionality.
- Vouchers: Create, Redeem, One Link and My Cards in `vouchers/VouchersExperience.tsx`; create/redeem previews and one-link design are present; secure QR/link creation, connected My Cards data, share success and receipt states remain open.
- Profile: reader-mode creator/portfolio workspace in `profile/ProfileExperience.tsx`; public creator route, profile identity/edit preview, Launches / Revenue / Vesting, daily-action sidebar and Horizon account detail are present; profile persistence, creator index, revenue ledger, streak/rewards and deep parity remain open.
- `docs/UI-PARITY-MAP.md` now maps the actual source component names from the supplied Base archive to NEXORA target files and records outstanding acceptance work.
- Latest Track A commits: `a165918` / `bc4e990` / `d67fc36` for the source map and roadmap; `b06bbd1` / `d9399a1` for the lending hierarchy patch. Vercel CI for the latest patch is still failing at the project build-rate limit; the latest READY production deployment is still commit `9752b16`, so the new UI patch is committed but not yet deployed.
- README.md has not been modified as part of these UI milestones.
- Reader-only safeguards remain in force for every financial write action.

Use the GitHub Actions run and Vercel deployment for the relevant commit as the source of truth for validation. A previous commit's green checks do not approve later changes.
