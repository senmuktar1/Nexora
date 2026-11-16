# NEXORA UI parity map

This is the working file-to-file map for Track A. The Base Analytics application remains the visual and interaction reference; NEXORA keeps its own Stellar identity, Emerald & Graphite palette, and dark/light themes.

## Shared application shell

| Reference surface | NEXORA implementation | Parity work still required |
|---|---|---|
| `components/shell/AppShell.tsx`, `components/wallet/AppHeader.tsx` | `src/components/nexora/NexoraApp.tsx` | Compare header height, spacing, action order, sticky behaviour, guest/connect state and route transitions. |
| `components/shell/MobileBottomNav.tsx`, `components/wallet/AppFooterNav.tsx` | `src/components/nexora/NexoraApp.tsx` | Compare safe-area spacing, active state, tap targets and content clearance at narrow widths. |
| `components/shell/CommandPalette.tsx`, `components/explore/ExploreSearchBar.tsx` | `src/components/nexora/NexoraApp.tsx`, `src/components/nexora/explore/ExploreExperience.tsx` | Verify open/close, keyboard navigation, search result grouping and route actions against the reference. |
| Shared theme and responsive tokens | `src/app/globals.css` | Compare dark and light states, typography, radii, shadows, spacing and breakpoints. |

## Main product surfaces

| Reference surface / user journey | NEXORA implementation | Current implementation boundary | Remaining Track A acceptance |
|---|---|---|---|
| Overview / Explore hero, featured spotlight, market overview, signals, discovery hub and Token Explorer | `components/explore/ExploreHub.tsx`, `ExploreLandingHero.tsx`, `ExploreHero.tsx`, `SpotlightCarousel.tsx`, `DiscoveryHub.tsx`, `MarketIntelligenceHub.tsx`, `SmartMoneyRadar.tsx`, `TokenTable.tsx`, `TokenCard.tsx`, `TokenQuickView.tsx`, `FilterBar.tsx`, `WatchlistAlertsPanel.tsx`; market surfaces: `components/markets/MarketsOverviewStrip.tsx`, `MoversSignalsStrip.tsx` | First-pass page with Horizon-backed XLM/USDC snapshot, asset search, discovery tabs, filters, watchlist and issuer quick-view. | Match exact section order, density, chart and card treatment; validate all filters and list/grid states; compare all five target widths. |
| Swap terminal, asset picker, portfolio, order/recurring tabs and quote details | `components/swap/SwapTab.tsx`, `DexSwapPanel.tsx`, `DexSwapCard.tsx`, `TokenSelectorModal.tsx`, `HoldingsDrawer.tsx`, `WalletHoldings.tsx`, `SwapPreviewModal.tsx`, `PopularChips.tsx`, `orders/OrdersView.tsx`, `orders/RecurringView.tsx`, `orders/MyOrdersPanel.tsx`, `orders/MyPlansPanel.tsx` | First-pass reader-mode terminal; asset identity and wallet balances are network-scoped; quote/route values remain unavailable. | Match reference trade-card composition, asset picker states, portfolio summary, detail disclosures and responsive layout. Keep trade submission disabled. |
| Lending overview, positions/health, spotlight, tokenized assets, vaults, scanner and protocol comparison | `components/lending/LendingHub.tsx`, `LendingHeader.tsx`, `LendingViewTabs.tsx`, `PositionsPanel.tsx`, `LiquidationGuardBanner.tsx`, `TopYieldSpotlight.tsx`, `MarketsTable.tsx`, `CompareTable.tsx`, `YieldFinder.tsx`, `ProtocolCompareHub.tsx`, `AssetDetailView.tsx`, `ActionDrawer.tsx` | First-pass workspace with read-only Blend and DeFindex discovery/inspection, positions and a labelled collateral stress preview. | Reference QA screenshots establish the desktop order as header/KPIs → disclaimer → dual segmented controls → positions/health. The current NEXORA order (header → positions → spotlight → one tab rail) does not match; rebuild the section order and dual-control hierarchy before deeper detail work. Then compare spotlight, dense table, drawers and mobile table behaviour. Do not infer a lending listing from a Horizon asset record. |
| Voucher create, redeem, share/link, My Vouchers, QR and receipt journeys | `components/voucher/VoucherLanding.tsx`, `VoucherHeader.tsx`, `VoucherSegmentTabs.tsx`, `VoucherCreateWizard.tsx`, `VoucherCardPreview.tsx`, `VoucherShareSuccessModal.tsx`, `VoucherMyCards.tsx`, `VoucherRedeemStatusBanner.tsx`, `panels/VoucherCreatePanel.tsx`, `VoucherMinePanel.tsx`, `VoucherRedeemPanel.tsx`, `VoucherViewPanel.tsx`; recipient/share surfaces: `components/wallet/VoucherSharePanel.tsx`, `VoucherRedeemReveal.tsx` | First-pass guided creator and reader-mode voucher views. | Match each reference step and state, QR/share modal, recipient journey, list, receipt, expired/claimed/invalid states and mobile share sheet. Keep funding and claim disabled. |
| Launch discovery, calendar, token detail and creator launch wizard | `components/launchpad/LaunchpadTab.tsx`, `LaunchpadExploreSections.tsx`, `LaunchCalendar.tsx`, `MyLaunchedTokens.tsx`, `TokenDetailPanel.tsx`, `TokenTerminal.tsx`, `TokenAnnouncementsPanel.tsx`, `TokenLaunchForm.tsx`, `IdentityStep.tsx`, `DistributionStep.tsx`, `LiquidityStep.tsx`, `ReviewStep.tsx`, `LaunchSuccessPanel.tsx`, `CreatorPageClient.tsx`, `CreatorProfilePanel.tsx` | First-pass multi-step issuer/launch preview with classic, Soroban and RWA paths. | Match discovery cards, filters, calendar, token terminal, creator view and full wizard states. Keep issuance and liquidity actions disabled. |
| Profile, portfolio, history, watchlist, settings and creator dashboard | `app/profile/page.tsx`, `components/profile/ProfileHeader.tsx`, `ProfileTabs.tsx`, `CreatorStats.tsx`, `DailyActionsPanel.tsx`, `EditProfileDrawer.tsx`, `LaunchPromoBanner.tsx`, plus wallet portfolio panels in `components/wallet/**` | First-pass creator/portfolio workspace with public account reads and preview-only identity editing. | Match profile tabs, portfolio summary, history, charts, watchlists, settings, creator analytics and earnings states. Never fabricate revenue or valuation. |

## Cross-surface implementation

| Concern | NEXORA target | Acceptance requirement |
|---|---|---|
| Route composition and navigation | `src/components/nexora/NexoraApp.tsx` and `src/app/**` | Every reference destination has a working NEXORA route or an explicitly labelled unavailable state. |
| Shared visual system | `src/app/globals.css` | Emerald & Graphite identity remains intact; dark and light themes both pass. |
| Wallet and network state | `src/components/wallet/**` and route components | Disconnected, connecting, connected, wrong-network, loading, empty and read-error states are distinct. |
| Dialogs, drawers, menus and keyboard access | Owning page component and `src/app/globals.css` | Escape dismissal, focus containment/restoration, visible focus, scroll locking and touch behaviour match the reference. |
| Financial action gating | Owning page component and Stellar API/contract layer | Every write remains disabled until its own Testnet acceptance gate passes. A UI preview is never presented as an executed transaction. |

## Viewport acceptance matrix

Every major screen must be checked at these exact widths in both dark and light themes:

- 390px — narrow mobile
- 640px — large mobile / small tablet
- 768px — tablet
- 1024px — compact desktop
- 1440px — desktop

For each width, record: reference screenshot, NEXORA screenshot, differences, interaction checks, accessibility checks and acceptance status. A component is not accepted merely because it renders.

## Source fidelity note

The source archive and supplied reference screens define the visual specification. This map records the reference surfaces and the current NEXORA target files. The reference archive has now been inspected directly. The component names above are taken from the supplied archive; the mapping identifies relevant source components, not a claim that every subcomponent has already been ported.
