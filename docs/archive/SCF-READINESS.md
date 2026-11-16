# Stellar Community Fund readiness — NEXORA

**Status: early foundation; not yet ready for a full SCF Build submission.**

This is a working fit and evidence plan, not an indication of SDF endorsement, eligibility or likely funding.

## 1. Proposed first release

NEXORA's first release is four interconnected Stellar financial modules:
1. Tokenized RWA discovery.
2. Yield aggregation.
3. Lending and borrowing.
4. Payment vouchers.

Wallet connectivity, portfolio visibility, verified asset records and explicit transaction approvals support all four. Advanced trading and DEX routing are a dedicated follow-on phase; token launchpad and AI/MCP remain later expansion features.

## 2. Why Stellar

Stellar has a live tokenized asset ecosystem. Stellar's RWA page reports $4B in tokenized RWAs and 67 tokenized products as of September 1, 2026. Issuer examples documented by Stellar include Franklin Templeton's BENJI, Spiko/Amundi tokenized money market funds including SAFO, Ondo USDY, and WisdomTree digital funds. The actual Stellar asset/contract identifiers, current values, access conditions and investor eligibility must still be verified product by product.

Stellar's borrowing/lending materials describe lending and yield infrastructure involving protocols such as Blend and DeFindex. The NEXORA opportunity is to bring discovery, source transparency, risk information and wallet-controlled interactions into a single application.

Sources:
- https://stellar.org/solutions/real-world-assets
- https://stellar.org/solutions/borrowing-and-lending
- https://stellar.org/ecosystem

## 3. Proposed differentiation

**Problem:** Users navigate separate issuer sites, fund documents, yield vaults, lending pool dashboards and wallet flows. They may struggle to compare terms or understand what is onchain-verifiable versus issuer-reported.

**Solution:** NEXORA presents issuer-aware RWA discovery, transparent yield comparisons, lending pool/risk information and a shareable Stellar payment-voucher lifecycle in one wallet-controlled workspace.

Distinctive product details:
- Asset Passport with issuer provenance, documented eligibility and verified onchain identifiers.
- Yield views separating issuer distribution/coupon, vault APY, incentive rewards and realized yield.
- Lending views showing utilization, available liquidity, collateral parameters and liquidation/oracle risks.
- Voucher creation/claim/expiry/refund states visible to creator and claimant.

This differentiation remains a hypothesis until competitor analysis and structured user interviews validate it.

## 4. SCF track assessment (provisional)

The SCF Build program has Open, Integration and RFP tracks. Confirm current requirements before selecting a track.

### Integration Track
DeFindex is included in the current published SCF Integration List as Stellar yield infrastructure, so it is the strongest direct first-release integration candidate at this review.

**Lending eligibility:** evaluate active pools and check the current SCF Integration List directly at the time of application. Do not infer protocol status or SCF eligibility from cached copies or third-party summaries.

For Integration Track:
- re-check the live Integration List immediately before applying;
- satisfy current traction/eligibility requirements;
- make most of the requested budget attributable to selected eligible integrations;
- do not imply that listing equals formal partnership or SDF endorsement.

### Open Track
Could be considered if NEXORA can prove differentiated value across the four-module product, meaningful Stellar-native usage, team capability and product-market fit.

### RFP Track
Only pursue if a currently open RFP specifically matches a defined piece of NEXORA's work.

Official references:
- https://communityfund.stellar.org/awards
- https://stellar.gitbook.io/scf-handbook/scf-awards/build-award
- https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/integration-track/integration-list

## 5. Evidence required before applying

### Product-market fit
- 15–20 structured interviews across users interested in tokenized RWAs, yield, lending or payment vouchers.
- Determine which problem is most frequent and urgent.
- Test all four workflows with at least 10 target users.
- Secure pilot commitments where feasible and record repeat usage.

### Technical readiness
- Working Testnet wallet connection and actual account/asset data.
- RWA registry with exact Stellar identifiers, official issuer links and eligibility caveats.
- Read-only DeFindex integration with transparent yield methodology.
- Verified lending pool data from a selected current protocol; Blend and Templar must be evaluated rather than assumed.
- One fully tested Testnet voucher flow with documented claim, expiry and refund behavior.
- Automated tests, stale-data handling, transaction preflight, monitoring and security review.

### Use of Stellar
Measure actual:
- unique connected Stellar wallets;
- verified RWA asset pages viewed and qualified asset interactions;
- yield vault comparisons and positions;
- lending market interactions and Testnet actions;
- vouchers created, claimed, expired and refunded;
- successful confirmed transactions and repeat usage.

### Team and delivery
Document actual team members, relevant experience, availability, work ownership and security responsibilities. Do not invent contributors, partnerships, traction or domain credentials.

## 6. Additional follow-on opportunity: trading and DEX routing

After the four-module first release, NEXORA can pursue an advanced Stellar trading terminal using a verified route provider such as Soroswap or Stellar Broker, both of which appear in the current SCF Integration List snapshot. Stellar's native path-payment functionality is also a relevant execution primitive.

This could support a separate later Integration Track proposal if it aligns with the live track requirements, budget rules and user traction. It is not included in the first-release scope or current MVP budget.

## 7. Suggested milestones

1. **MVP:** wallet/read-only data foundation, first issuer-verified RWA records, DeFindex read-only yield module, lending protocol diligence/data model, voucher architecture decision.
2. **Testnet:** working RWA and DeFindex data, selected lending pool read/transaction flow, end-to-end voucher create/share/claim/expiry test.
3. **Mainnet:** production integrations, security review, monitoring, support process, disclosures and limited rollout.

Use the exact current SCF deliverable and tranche rules. This is a proposed delivery plan, not a guarantee of eligibility or funding.

## 8. Budget discipline

Do not request the maximum by default. Budget from real contributor time, integration effort, provider costs, security review, hosting/indexing and measured deliverables. For Integration Track, most of the requested budget must support the eligible selected building block(s). DeFindex is a strong current candidate; check the live Integration List for each additional building block before finalizing the budget.

## 9. Current evidence gaps

- No validated interviews, pilot commitments or product-retention evidence in the repository.
- No working Stellar wallet integration or verified RWA registry shipped yet.
- DeFindex integration not implemented or provider-verified.
- Lending provider and active pool have not yet been selected; protocol status, data access and SCF eligibility require diligence.
- Voucher mechanism not selected and no security-tested Testnet lifecycle exists.
- No confirmed provider partnerships, team roster or delivery budget.
- No competitor research yet.

These are work items to close before applying.

## 10. Round timing

SCF Build rounds and deadlines can change. Check the current awards page and handbook rather than assuming a fixed cadence. The previously referenced SCF #46 deadline of November 9, 2026 has passed.

Current awards page: https://communityfund.stellar.org/awards
