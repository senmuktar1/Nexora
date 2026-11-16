# NEXORA — Base Analytics UX parity implementation

## Objective

Rebuild the supplied Base Analytics application experience in NEXORA with the same screen structure, navigation, responsive behaviour, interaction patterns, component hierarchy and user journeys.

The intended product differences are limited to:
1. NEXORA's existing brand mark from `/public/nexora-mark.svg`;
2. NEXORA's Emerald & Graphite colour tokens and typography/brand treatment;
3. Stellar/Soroban-native assets, wallet identity, market sources and protocol content;
4. reader-only behaviour until each Stellar transaction workflow is separately approved for implementation.

This is a product upgrade, not a new information architecture. Do not redesign a page because its Stellar integration is not ready. Keep the original UI and show real reader data, a quiet empty state, a disabled write action or a clearly-labelled unavailable state as appropriate.

## Implementation status — 13 November 2026

The following first UI milestone has been committed to `main`. These are reader-mode UX implementations, not finished Stellar transaction integrations.

| Surface | NEXORA component | Current interaction coverage | Remaining before UI acceptance |
|---|---|---|---|
| Brand and shared shell | `NexoraApp.tsx`, `globals.css` | Official `nexora-mark.svg`, horizontal desktop navigation, mobile search, six-item bottom nav, wallet/account menu, theme and network controls | Pixel comparison at reference viewports; keyboard/outside-click and small-device audit |
| Overview / Explore | `explore/ExploreExperience.tsx` | Hero/search, rotating featured panel, live XLM/USDC market snapshot and chart, signal cards, discovery tabs, issuer references, asset explorer, local watchlist, quick-view drawer, deep-link to Swap by code+issuer | Additional reference card/table/drawer parity; viewport screenshot comparison; verify exact mobile snap/scroll behaviour |
| Swap | `swap/SwapExperience.tsx` | Market/Orders/Recurring tabs, editable amount, sell/buy asset selection, asset picker backed by Horizon search, flip pair, balance percentages, portfolio drawer, slippage/route settings preview, order/recurring forms | Route adapter and quote details are not connected; complete holdings pricing, native offers/recurring integrations and screenshot-level layout comparison |
| Vouchers | `vouchers/VouchersExperience.tsx` | Create/Redeem/My Cards tabs, four-step wizard, issuer-aware asset selection, amount split, personalization, card preview, expiry/unlock preview, redeem entry and FAQ | QR/share deep-link creation, public voucher pages, card history and claim/receipt UI parity |
| Launch | `launch/LaunchExperience.tsx` | Discover/Create/My Launches/Calendar tabs, five-step issuance preview, supply allocation validation, issuer control preview and review summary | Announcement feed, token terminal/detail page, creator-specific screens and complete visual comparison |
| Profile | Existing account page | Public account balances and recent transaction records from Horizon | Reference profile tabs, portfolio allocation/history, watchlists/settings, creator profile and analytics |

The first new components are deliberately isolated under `src/components/nexora/{explore,swap,vouchers,launch}/`. Avoid restoring the former single-file page implementations or growing `NexoraApp.tsx` into a new monolith.

**Reader-mode enforcement:** only preview inputs and public-data navigation are enabled. Swap, order placement, recurring execution, voucher funding/claiming/refunding and asset issuance remain disabled. No placeholder output amounts, market-wide rankings, APY or portfolio USD valuations are invented.

**Next acceptance gate:** CI must pass typecheck, lint and production build for the current commit; then the UI should be checked against the reference at 390, 640, 768, 1024 and 1440 pixel widths. The feature integrations should start only after this UI acceptance pass.

## Source archive audit

The user-provided `Base-analytics-app-main.zip` is the authoritative UX reference and is read-only. The inspected archive contains 1,293 files. The major source groups include 197 React components, 96 App Router app files, 358 library files, 331 public assets and 78 documentation files.

The primary UI composition in the reference is:
- `components/home/HomeApp.tsx`: application state/orchestration, tabs and screen composition;
- `components/wallet/AppHeader.tsx`: desktop inline navigation, guest/connect state, unified account menu, language/theme controls;
- `components/shell/AppShell.tsx`: content container, mobile search shortcut, command palette and bottom navigation;
- `components/shell/MobileBottomNav.tsx`: six-item mobile navigation;
- `components/shell/CommandPalette.tsx`: global keyboard/search navigation;
- `components/ui/AppLogo.tsx`: reference logo component (do not copy its Base mark; use NEXORA's own SVG instead).

### Exact responsive shell behaviour to preserve

- Header stays horizontal. On desktop the navigation is inline between brand and right-side utilities.
- On mobile the desktop nav is hidden; there is no hamburger replacement. Brand, language, theme and connect/account controls remain in the compact header.
- Mobile shows the search/command shortcut immediately below the header.
- Mobile uses the fixed six-item bottom navigation: Explore, Swap, Lend, Launch, Vouchers, Profile. It respects `safe-area-inset-bottom`.
- Desktop uses the same routes through the top navigation; page-level controls and drawers remain available.
- The reference's full-width `.app-container` uses 12px gutters by default, 16px at 640px, 24px at 1024px and 32px at 1280px, including safe-area insets.
- Preserve the same card hierarchy, tab controls, tables, drawers, dialogs, quick views, sticky/scroll areas and empty-state geometry. Mobile cards that are horizontal snap rails must remain horizontal snap rails, not be changed to unrelated grids.
- Match the original breakpoints and interaction affordances before tuning small decorative differences.

## Reference route and component map

| Product surface | Base Analytics reference route(s) | Reference UI source files | NEXORA target files |
|---|---|---|---|
| Shared shell | `/`, all in-app tab routes | `components/home/HomeApp.tsx`, `components/wallet/AppHeader.tsx`, `components/shell/AppShell.tsx`, `components/shell/MobileBottomNav.tsx`, `components/shell/CommandPalette.tsx` | `src/components/nexora/shell/NexoraAppShell.tsx`, `NexoraHeader.tsx`, `NexoraMobileBottomNav.tsx`, `NexoraCommandPalette.tsx`, `NexoraGuestBanner.tsx` |
| Explore / market discovery | `/`, `/explore`, `/explore/token/[address]` | `components/explore/ExploreHub.tsx`, `ExploreHero.tsx`, `ExploreLandingHero.tsx`, `DiscoveryHub.tsx`, `DiscoveryRow.tsx`, `ExploreSegmentTabs.tsx`, `FilterBar.tsx`, `TokenTable.tsx`, `TokenCard.tsx`, `TokenQuickView.tsx`, `MarketIntelligenceHub.tsx`, `MarketPulse.tsx`, `MarketsOverviewStrip.tsx`, `MoversSignalsStrip.tsx`, `SmartMoneyRadar.tsx`, `SpotlightCarousel.tsx`, `WatchlistAlertsPanel.tsx` | `src/components/nexora/explore/ExplorePage.tsx` and focused components under `src/components/nexora/explore/` |
| Swap terminal | `/swap`, `/swap/token/[address]` | `components/swap/SwapTab.tsx`, `DexSwapPanel.tsx`, `DexSwapCard.tsx`, `TokenSelectorModal.tsx`, `SwapPreviewModal.tsx`, `PopularChips.tsx`, `SwapQuickPick.tsx`, `WalletHoldings.tsx`, `HoldingsDrawer.tsx`, `orders/OrdersView.tsx`, `RecurringView.tsx`, `MyOrdersPanel.tsx`, `MyPlansPanel.tsx`, `EditOrderModal.tsx` | `src/components/nexora/swap/SwapPage.tsx`, `DexSwapPanel.tsx`, `TokenSelectorModal.tsx`, `SwapPreviewModal.tsx`, `MarketView.tsx`, `OrdersView.tsx` |
| Lend & Stake / Earn | `/lend`, `/earn` | `components/lending/LendingHub.tsx`, `LendingViewTabs.tsx`, `ProtocolCompareHub.tsx`, `ProtocolCard.tsx`, `TopYieldSpotlight.tsx`, `YieldFinder.tsx`, `MarketsTable.tsx`, `CompareTable.tsx`, `GaugesTable.tsx`, `AssetDetailView.tsx`, `PositionsPanel.tsx`, `ActionDrawer.tsx`, `LendingActionModal.tsx`, `LiquidationGuardBanner.tsx` | `src/components/nexora/lend/LendingPage.tsx` and focused views/cards/tables/drawers under `src/components/nexora/lend/` |
| Voucher creation and wallet voucher hub | `/` voucher tab, `/pay/[address]`, `/redeem`, `/receipt/[txHash]` | `components/wallet/tabs/BaseVoucherTab.tsx`, `components/voucher/VoucherLanding.tsx`, `VoucherCreateWizard.tsx`, `VoucherSegmentTabs.tsx`, `VoucherCardPreview.tsx`, `VoucherShareSuccessModal.tsx`, `VoucherHowItWorks.tsx`, `VoucherMyCards.tsx`, `VoucherRedeemStatusBanner.tsx`, `panels/VoucherCreatePanel.tsx`, `VoucherMinePanel.tsx`, `VoucherRedeemPanel.tsx`, `VoucherViewPanel.tsx` | `src/components/nexora/vouchers/VouchersPage.tsx`, `VoucherCreateWizard.tsx`, `VoucherCardPreview.tsx`, `VoucherShareView.tsx`, `VoucherRedeemView.tsx`, `VoucherReceiptView.tsx` |
| Launchpad | `/launch` | `components/launchpad/LaunchpadTab.tsx`, `LaunchpadExploreSections.tsx`, `B20TokensSection.tsx`, `RecentlyLaunchedSection.tsx`, `LaunchCalendar.tsx`, `TokenLaunchForm.tsx`, `IdentityStep.tsx`, `DistributionStep.tsx`, `LiquidityStep.tsx`, `ReviewStep.tsx`, `LaunchOptionsPanel.tsx`, `LaunchReadinessSimulator.tsx`, `LaunchConfigSummary.tsx`, `LaunchSuccessPanel.tsx`, `TokenTerminal.tsx`, `TokenDetailPanel.tsx`, `TokenChartPanel.tsx`, `MyLaunchedTokens.tsx`, `TokenAnnouncementsPanel.tsx`, `TokenWatchlistRail.tsx` | `src/components/nexora/launch/LaunchPage.tsx`, `LaunchDiscovery.tsx`, `LaunchWizard.tsx`, step components, `LaunchSuccess.tsx`, `AssetTerminal.tsx`, `MyLaunches.tsx` |
| Creator profile | `/creator/[address]` | `components/launchpad/CreatorPageClient.tsx`, `CreatorProfileCard.tsx`, `CreatorProfileForm.tsx`, `CreatorStats.tsx` | `src/components/nexora/profile/CreatorProfilePage.tsx`, `CreatorStats.tsx`, `EditProfileDrawer.tsx` |
| User profile / portfolio | `/profile` | `components/profile/ProfileHeader.tsx`, `ProfileTabs.tsx`, `CreatorStats.tsx`, `components/wallet/WalletStatsSections.tsx`, `ActivityHeatmap.tsx`, `PortfolioTimeMachine.tsx`, `WatchlistPanel.tsx`, `ReferralPanel.tsx`, `RewardsSegmentTabs.tsx`, `DailyActionsPanel.tsx` | `src/components/nexora/profile/ProfilePage.tsx`, `ProfileHeader.tsx`, `ProfileTabs.tsx`, `PortfolioOverview.tsx`, `ActivityHistory.tsx`, `WatchlistPanel.tsx`, `SettingsPanel.tsx` |
| AI / alerts / supporting surfaces | `/capture`, help/docs/legal routes | `components/alerts/SmarterAlertsPanel.tsx`, `WatchlistAlertsPanel.tsx`, `components/docs/DocumentsClient.tsx`, `components/compliance/StockRiskModal.tsx` | `src/components/nexora/ai/`, `alerts/`, `docs/`, `compliance/` |

## NEXORA's current architecture gap

At the time of this audit, NEXORA has 23 App Router page entries, but most page entries delegate to the single large `src/components/nexora/NexoraApp.tsx` file. The UI implementation is concentrated in that monolith, alongside the separate `src/components/wallet/WalletProvider.tsx`; the remaining current components are not yet decomposed into the corresponding reference feature groups.

This is a core reason earlier iterations felt approximate. The parity work will progressively split the monolith into focused components that correspond to the Base source structure. Do not continue growing the monolith.

## File-by-file implementation sequence

### Batch 0 — Brand and global shell
1. Use the actual `public/nexora-mark.svg` for every NEXORA brand-mark placement. Do not redraw or approximate it with the Base logo geometry or a generic "N".
2. Match the shared header, account dropdown, language/theme controls, guest banner, search/command palette, page gutters, footer and mobile bottom navigation.
3. Move network selection into the same account/network context without changing the reference header geometry.
4. Keep Emerald & Graphite as the only brand-colour substitution.

### Batch 1 — Explore
Split the current Explore implementation into the hero/search, featured market spotlight, overview strip, movers/signals, discovery tabs/cards, filter bar, asset table, quick-view/detail drawer, intelligence panels and watchlist components. Preserve their order and responsive behaviour from the source.

### Batch 2 — Swap
Recreate the complete swap page hierarchy and its tab/selector/drawer/modal interactions. Use Stellar asset identities (native XLM or code + issuer; Soroban contract ID where applicable). In reader-only mode, preserve the UI but keep all swap/order execution controls disabled.

### Batch 3 — Lend & Stake
Recreate protocol discovery, yield spotlight, finder, market tables, compare tables, asset detail, positions and action drawer/modal. Populate only verified read-only data. All deposit/borrow/repay/withdraw/stake writes remain disabled.

### Batch 4 — Vouchers
Recreate the landing, segments, create wizard steps, preview card, share-success modal, QR/link, my vouchers, redeem view and receipt pages. Preserve state transitions visually, but prevent funding, claiming, refunding or transferring on-chain in reader mode.

### Batch 5 — Launchpad and creator
Recreate discovery, launch cards, calendar, announcements, token terminal/detail, creator page and the entire multi-step launch wizard. Keep create/issue/distribution/liquidity writes disabled. Show the correct Stellar path (classic asset or Soroban token) as an explicit design decision, not as an EVM token drop-in.

### Batch 6 — Profile / portfolio and remaining surfaces
Recreate profile tabs, portfolio overview, account activity, asset balances, charts/heatmaps, watchlist, creator statistics, alerts, settings, docs/help/legal and public share/pay/receipt pages.

### Batch 7 — Visual and interaction acceptance
Check each screen at 390px phone, 640px small tablet, 768px tablet, 1024px laptop and 1440px desktop widths. Compare against the corresponding source screen at the same viewport. Verify navigation, tabs, menus, horizontal swipe rails, drawers, modal size/position, sticky elements, scrolling, safe areas and touch targets. A route is not accepted merely because it returns HTTP 200.

## Reader-only contract

Reader-only means the UI is complete, not that pages are placeholders.

Allowed:
- Search and inspect Stellar assets, issuer IDs and public market/protocol data.
- Open token details, market views, filters, tabs, profile and portfolio screens.
- Connect a Stellar wallet to read its public account data.
- Preview forms and transaction details without preparing/signing/submitting them.

Disabled:
- Swap execution, limit order placement/cancellation and recurring orders.
- Lending deposits, withdrawals, borrow, repay, stake and unstake.
- Voucher funding, claiming and refunding.
- Asset issuance, launch liquidity and launch transactions.
- Any flow that spends or moves user funds.

Do not use fake/demo metrics to make a screen look finished. Use real data with provenance, a neutral empty state, a skeleton only where it matches the reference, or a clearly-marked unavailable state.

## Acceptance rule

The Base Analytics ZIP is the source of truth for information architecture, component placement, sizing, responsive behaviour and user flow. NEXORA is a chain-native upgrade, not a UX redesign. For each batch, preserve the original source's UI/interaction pattern and replace only branding, palette and chain-specific data/logic.
