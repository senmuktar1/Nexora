# NEXORA — Final Technical Handover (RWA, administration & production readiness)

Release branch: **`feature/rwa-admin`** (the only branch in `NEXORA-FINAL-GIT.bundle`; its history includes the earlier wallet release). Deploy this branch. GitHub `drmukty/nexora` was not reachable from the build environment, so this was not rebased on any newer GitHub commits.

## 1. What changed in this release

- **Persistent backend:** PostgreSQL (Supabase-compatible) schema and migrations, server-only access, row-level security on every table.
- **NEXORA accounts** for issuers and investors (email + password, verified email). These are separate from the wallet; keys still never leave the browser.
- **Private admin portal** on its own host (`ADMIN_HOST`, e.g. `admin.nexora.com`): one-time Super Admin bootstrap bound to the private `NEXORA_ADMIN_EMAIL`, email verification, mandatory TOTP MFA, permissions, review tools, audit log, settings and an owner-only recovery CLI.
- **RWA programme:** applications, encrypted documents, review workflow, verification findings, a separate final tokenization authorization, wallet-signed issuance verified on-chain, a public offerings explorer, subscriptions, redemption requests and lifecycle records.
- **Design:** unchanged. New pages reuse the Emerald & Graphite tokens and components; the admin portal has its own sidebar layout in the same visual language. One navigation item ("RWA") and footer links were added.
- **Unchanged:** every existing module and control (wallet, guard, approval sheet, XDR inspection, signature verification, network restriction, wasm hash pinning, fee limits, duplicate protection, regional restrictions, legal pages).

## 2. Architecture

| Layer | Details |
|---|---|
| Frontend | Next.js 16 App Router, React 19, TypeScript. Public app (`NexoraApp` shell) + `/rwa`, `/rwa/apply`, `/rwa/<ref>`, `/rwa/applications/<ref>`, `/account`. Admin app under `/admin/*` (served only on `ADMIN_HOST`). |
| Server | Route handlers on the Node.js runtime: `api/stellar/*` (unchanged), `api/account/*`, `api/rwa/*`, `api/admin/*`. Uniform error handling (`route()` wrapper), CSRF origin checks, rate limits, `X-Nexora-Message` for user-safe errors. |
| Database | PostgreSQL 15+. `db/migrations/0001_init.sql` (15 tables) and `0002_tx_hash_uniqueness.sql` (transaction-hash registry + unique indexes). `npm run db:migrate`. Driver `postgres` 3.4.9 with `prepare:false` (Supabase transaction pooler). |
| Host separation | `src/proxy.ts`: on `ADMIN_HOST` only `/admin`, `/api/admin/*` and `/api/health` are served; elsewhere they return 404. Enforced again in the admin layout and every admin API. |
| Email | Resend HTTPS API (`RESEND_API_KEY`, `EMAIL_FROM`). A database outbox exists only for local automated tests and is refused on Vercel/Netlify. |
| Wallet / Stellar | Unchanged. RWA issuance reuses the existing classic launch flow (with authorization required + revocable + clawback, no allocations, no DEX listing, issuer not locked). Trustline authorisation and delivery use new builders (`src/lib/stellar/rwa-ops.ts`) through the same guard and approval sheet. |

### Database tables

`app_users` (realm public/admin, role, status, MFA), `sessions` (hashed tokens), `email_tokens`, `login_attempts`, `platform_settings`, `admin_bootstrap` (single row, closes setup forever), `admin_audit_log`, `rwa_applications`, `rwa_documents` (AES-256-GCM ciphertext), `rwa_findings`, `rwa_status_history`, `rwa_token_configs`, `rwa_subscriptions`, `rwa_asset_events`, `email_outbox` (tests only). A unique index allows only one Super Admin; a check constraint keeps public accounts to role `user`.

## 3. Administrator access

| Requirement | Implementation |
|---|---|
| Founder email private | `NEXORA_ADMIN_EMAIL` read only on the server; never sent to the browser (bundle scan in the evidence). |
| No public admin registration / role selection / self-promotion | Public sign-up creates realm `public`, role `user` only (DB constraint). No API accepts a role. |
| Unauthorised emails rejected | Bootstrap and sign-in compare with the configured email in constant time; attempts are audited. |
| One-time bootstrap | Email link **and** the same password, then TOTP enrolment; completion inserts the single `admin_bootstrap` row. No second Super Admin can exist (unique index). |
| Secure sessions | 256-bit tokens stored hashed; `__Host-` HttpOnly Secure SameSite=Strict host-only cookies; 30 min idle / 8 h absolute; revoked on suspension/recovery. |
| MFA required | TOTP (RFC 6238) with replay protection and 10 single-use recovery codes. Admin APIs require MFA in the session. |
| Email change never silent | If `NEXORA_ADMIN_EMAIL` changes, the existing Super Admin is locked out (sessions and sign-in refused). `npm run admin:recovery -- change-email …` performs the audited migration. |
| Admin independent of the wallet | Separate account and cookie; no wallet involvement. |
| Extensible roles | `super_admin` (all), `reviewer` and `compliance` permission sets in `src/lib/server/auth/guard.ts`; no UI creates staff yet (deliberately). |

Super Admin capabilities in the portal: overview; applications (filter/search); application review (documents, issuer declarations, verification findings and internal notes, request information, approve, reject, suspend, reinstate); tokenization authorization (system checks + reviewer confirmations, return/revoke); listing/unlisting offerings and publishing offering documents; lifecycle records and redemption/incident handling; assets & tokens with live on-chain checks; users & issuers (suspend/reactivate with reason); audit log; platform settings (applications open, subscriptions open — **closed by default**, clawback requirement, authorization validity, risk disclosure).

## 4. RWA workflow

1. **Apply** (`/rwa/apply`, signed-in verified account): category (real estate, gold & commodities, agriculture, private credit, government securities, money market funds, renewable energy, other) and all requested fields; documents (ownership, valuation, offering, registration required; insurance, custody, legal opinion, inspection, other optional). Reference `RWA-YYYY-XXXXXX`.
2. **Submit** → **Under review** → **Additional information requested** (applicant edits and re-submits) → **Approved** / **Rejected** → **Suspended** / reinstated. Every change: history row + audit entry (reference, admin, action, time, reason, previous/new status). Applicants see status, information requests and decision reasons, never internal notes.
3. **Findings** distinguish *Issuer declaration* / *Verified by NEXORA* / *Could not verify*; a verified finding must cite a document.
4. **Token configuration** (after approval): code, supply, price, minimum investment, rights, ownership structure, distribution rules, eligibility, transfer restrictions, redemption terms, distribution address, clawback.
5. **Final authorization** (separate, admin): application approved; offering documents; verified issuer/ownership/valuation findings; configuration submitted; on-chain transfer controls; distribution address matches; **a legal opinion / regulatory clearance document** (uploaded by the issuer, also allowed after approval) **recorded as verified by a reviewer and selected for the authorization**; a descriptive counsel/regulator reference; configuration matches offering; issuer authorised; explicit Mainnet authorization. A typed reference alone is never accepted as proof of clearance; the authorization stores the document ID and SHA-256. Expires after the configured days. **No automatic deployment.**
6. **Issuance** by the issuer from their own wallet (approval sheet). The server records it only after verifying the confirmed transaction on Horizon against the one acceptable shape: exactly five operations in order — create_account (distribution D → new issuer I, 1.5 XLM), set_options (I; flags exactly required + revocable [+ clawback]; nothing else), change_trust (D), set_trust_line_flags (I authorises D), payment (I → D, exact supply) — each with the expected source, destination, asset and amount. Trustline authorisation (exactly one set_trust_line_flags by I for that investor) and delivery (exactly one payment D → investor for the subscribed amount) are verified the same way, independently. Extra operations of any kind are refused. Horizon's `operation_count` must be present, a positive integer and equal to the operations returned. A transaction can be recorded for only one step, globally and **atomically**: the hash is reserved in `rwa_recorded_transactions` (primary key) inside the same database transaction that changes the status and writes the event and audit entry, so two concurrent requests — for different subscriptions, steps or applications — can't both record the same hash, and a failed recording leaves no reservation.
7. **Offerings** are public only when approved, issued and listed by an admin. They show issuer, category, valuation and date, verification status per subject, legal structure, public documents, supply, price, eligibility, transfer restrictions, redemption, risk disclosure and on-chain links. No return or liquidity claims.
8. **Subscriptions** (when enabled): request with eligibility + risk attestations → issuer accepts → investor adds trustline → issuer authorises the trustline (wallet + locally stored issuer key) → issuer delivers tokens. Each on-chain step is verified on Horizon before it's recorded. Payment settlement between investor and issuer is off-platform under the offering terms (NEXORA does not take custody of funds).
9. **Lifecycle:** valuation updates, custody, insurance, inspections, revenue, distributions, incidents, issuer reports (issuer or admin, optional encrypted file, public or private), redemption requests (holders), status changes; on-chain vs off-chain labelled.

**Why a classic asset, not the Soroban token, for RWA:** the existing Soroban contract is a fixed-supply SEP-41 token with no allowlist, freeze, clawback or redemption logic, so it can't enforce transfer restrictions. Classic Stellar assets with authorization required + revocable + clawback enforce issuer approval of every holder at the protocol level. The Soroban path and its tests are unchanged.

## 4b. Test evidence

All results below come from `NEXORA-FINAL-SOURCE.zip` extracted into a new, empty directory (clean room) on 16 Nov 2026, with a local PostgreSQL 16 server. Logs are in `NEXORA-FINAL-TEST-EVIDENCE.zip`. The only difference between the verified ZIP and the delivered ZIP is this section of this file.

| Check | Result |
|---|---|
| `npm ci` → typecheck → lint | ✅ pass (0 errors, 0 warnings) |
| Vitest unit + integration (incl. **43 database-backed** tests against real PostgreSQL and **28 transaction-shape** tests) | ✅ **214/214**, 0 skipped (23 files) |
| `npm audit --omit=dev` | ✅ 0 vulnerabilities |
| Contract `cargo test` | ✅ 7/7; wasm SHA-256 = pinned `80d27ccd…5038878` |
| `npm run db:migrate` on a fresh database, run twice | ✅ applies `0001` + `0002` once, then reports up to date |
| Production build (`next build`) | ✅ pass |
| Browser suites vs `next start` (+ PostgreSQL + local mock Horizon) | ✅ rwa-admin **55**, wallet 23, swap 15, trading 8, vouchers 16, launch 16, soroban-token 15, lending 6, defindex 6, rwa 7, ui-audit **294**, regions 6 = **467/467** |
| Host separation (curl) | ✅ public `/admin` 404, public `/api/admin/*` 404, admin host `/api/stellar/*` 404 |
| Browser bundle scan for configured secret values (DB URL, admin email, encryption key) | ✅ none in `.next/static` |
| `vercel build` (Vercel CLI 65.16.0) | ✅ pass; Node 22 functions; `maxDuration` 30 s on document upload, issuance verification and Soroban routes; 15 s on submit |

**Audit corrections (this delivery).** (1) *Atomic hash uniqueness:* new database tests prove that two concurrent requests recording one trustline-authorisation hash for two different subscriptions (both valid on-chain) end with exactly one 200 and one 409, one recorded hash and the losing subscription unchanged; that 10 parallel recordings of one hash across steps and subscriptions, each holding its transaction open, yield exactly one success and nine `TxHashReused` errors with the work applied once; that a failed recording leaves no reservation; and that the database itself refuses duplicate hashes across the registry and the hash columns. (2) *Strict `operation_count`:* for issuance, authorisation and delivery, a missing count and invalid values (`null`, numeric strings, fractions, 0, negatives, NaN, Infinity, >100, arrays, objects, booleans) are refused, as are counts above or below the operations returned; the exact count is accepted.

**Final hardening pass (previous delivery).** `tests/rwa-verify.test.ts` checks each on-chain step independently against its single acceptable shape and refuses: additional payments (token or XLM), duplicate account creation, unexpected set_options (extra op, signer, master-weight lock, home domain, thresholds, extra/missing/cleared flags, wrong source), unrelated trustline operations (other asset, other trustor, other issuer, wrong flags, extra change_trust or set_trust_line_flags), wrong sources/destinations/amounts/order, incomplete listings, failed operations, and one step's transaction being used for another. The database test adds: a typed counsel reference alone is refused; a legal-clearance finding can't be verified against an unrelated document; an unverified or merely declared legal opinion doesn't count; the selected document must be the verified one; after approval the issuer may add only the legal clearance document, and nothing after authorization; the authorization stores the document ID and SHA-256; an issuance with an extra payment is refused. The browser suite adds the same legal-clearance round trip through the UI, and its issuance, authorisation and delivery transactions (really signed in the browser) pass the stricter checks.

**What the new tests cover.** Database tests (`tests/backend-admin.test.ts`, `tests/backend-rwa.test.ts`): host separation, bootstrap refusal for other emails, CSRF, verification needing link + password, cookie flags, MFA enrolment, one-time bootstrap and single Super Admin enforced by the database, TOTP replay refusal, single-use recovery codes, realm separation, lockout, `NEXORA_ADMIN_EMAIL` change locking access, audited settings, logout, RLS on every table; application validation, required documents, content sniffing, size limit, encryption at rest, owner-only access, review transitions, information requests, findings (verified requires a document), internal notes hidden from applicants, approval reasons and audit, tokenization locked before approval, every authorization check, issuance verification rejecting wrong flags / locked issuer / wrong supply / wrong sender / other users, listing, public vs private documents, subscriptions (closed by default, minimums, attestations, one open request, issuer can't subscribe), on-chain verification of authorisation and delivery, lifecycle and redemption, suspension delisting, applicants can't reach admin APIs. Unit tests (`tests/auth-unit.test.ts`): RFC 6238 vectors, scrypt, AES-GCM binding/tamper, filename sanitising, token-config validation, permissions, proxy host routing.

The **rwa-admin browser suite** drives the real UI end to end: bootstrap with a wrong email (refused) and the founder email, link + password, QR/TOTP enrolment, recovery codes, sign-out and sign-in with a fresh TOTP, cookie flags; issuer sign-up, verification, wallet link, application, uploads (fake PDF refused), submit, information request round-trip, findings, approval; token configuration, refused then granted authorization; **issuance signed in the issuer's wallet through the approval sheet** (flags 11 = required + revocable + clawback, issuer not locked) and verified by the server against the exact signed transaction; listing; investor on a phone viewport (no horizontal scroll) signs up, subscribes, adds the trustline from their wallet; issuer authorises it (co-signed by wallet + issuer key) and delivers 500 tokens; lifecycle report, redemption request, acknowledgement; suspension removes the offering; audit log, users, on-chain check; admin portal at phone width in light theme.

**Mocked vs live.** Browser-side Stellar APIs are mocked; the server's on-chain verification ran against a **local mock Horizon** fed with the transactions the browser actually signed. Email used the test outbox. **Nothing was tested against live Stellar Mainnet, Supabase, Resend or a deployed domain, and no transactions were broadcast.**

### Acceptance table

| Requirement | Status | Evidence |
|---|---|---|
| Design preserved | Done | Existing suites unchanged and passing; ui-audit 294/294 (29 routes × guest/wallet × dark/light × desktop/mobile) |
| Existing functionality preserved | Done | wallet, swap, trading, vouchers, launch, soroban-token, lending, defindex, rwa, regions suites all pass |
| Private admin portal, host-separated | Done | proxy unit tests; DB tests; e2e; curl checks |
| Founder-only bootstrap, server-side email check, MFA, secure sessions | Done | backend-admin 20 tests; rwa-admin e2e |
| No public admin registration / self-promotion | Done | DB constraint + tests |
| Email change requires explicit migration | Done | test + recovery CLI (exercised on a scratch DB) |
| RWA submission with documents, unique reference, persisted | Done | backend-rwa + e2e |
| Review workflow, statuses, decisions recorded | Done | backend-rwa + e2e + audit checks |
| Declarations vs verified evidence | Done | findings model, offering page, tests |
| Separate final tokenization authorization; no automatic deployment | Done | checklist tests; issuance only from the issuer's wallet |
| On-chain issuance/authorisation/delivery verification — exact operation counts, types, sources, destinations; extra operations refused; each step independent; Horizon `operation_count` required and consistent | Done (mock Horizon) | rwa-verify 28 tests + backend-rwa + e2e |
| Globally unique, atomically recorded transaction hashes (concurrency-safe) | Done | 5 database tests incl. real parallel transactions |
| Legal clearance backed by a verified document (reference alone refused) | Done | backend-rwa + e2e |
| RWA explorer / investor experience | Done | e2e (desktop + mobile) |
| Lifecycle management | Done | backend-rwa + e2e |
| DB schema, migrations, RLS, server-only access | Done | migrate twice; RLS test; bundle scan |
| Vercel readiness | Done (build-verified, not deployed) | `vercel build` |
| Live production / Mainnet verification | **Not done** | No access and not authorised |

**Engineering completion (agreed scope):** about 95%. Everything requested is implemented and tested locally; the remainder is the items under Known limitations that need your accounts or decisions (live Supabase/Resend/domain run, CI on GitHub, KYC provider choice, counsel review).
**Live production verification:** 0% — to be done by you after deployment with the checklist in the deployment guide.

## 5. Known limitations

- **No live Mainnet verification** and no real-service verification of Supabase, Resend or a deployed domain from this environment. All Stellar responses in tests are mocked (browser-side) or served by a local mock Horizon (server-side verification).
- **Email delivery** via Resend is implemented to their documented HTTPS API but was not exercised against Resend (no account/key; outbound blocked). The verified path is the test outbox.
- **Legal and regulatory:** NEXORA's checklist records legal clearance but cannot provide it. Offerings, eligibility rules and subscriptions must be cleared by qualified counsel in each relevant jurisdiction before you open subscriptions. Legal documents remain drafts.
- **KYC/AML:** investor eligibility is an attestation plus the issuer's manual approval of each trustline. No identity-verification provider is integrated (it would be a paid service requiring your approval).
- **Settlement:** subscription payments are settled between issuer and investor outside NEXORA; only token delivery is on-chain.
- **Staff roles** exist in the permission model, but there's no UI to invite staff yet (by design: no open admin registration).
- **Rate limits** for non-login routes are per server instance; sign-in lockouts are database-wide.
- **Netlify:** this release was build-verified on Vercel only. The previous release was verified on Netlify; the new routes add no Netlify-specific features, but rerun `netlify build` if you choose Netlify.
- Earlier limitations still apply (contract not independently audited; CI not yet run on GitHub Actions; DeFindex interface source; Netlify function time limit).

## 6. Owner actions before go-live

1. Create the Supabase project, set `DATABASE_URL`, run `npm run db:migrate` (guide §3a).
2. Generate `DATA_ENCRYPTION_KEY` and store an offline copy.
3. Set up Resend (`RESEND_API_KEY`, `EMAIL_FROM`) (guide §3c).
4. Add `admin.<your-domain>` to the project; set `ADMIN_HOST` and `NEXORA_ADMIN_EMAIL`; redeploy; complete the bootstrap (guide §3b).
5. Run the production verification checklist (guide §6).
6. Have counsel review the legal documents, offering requirements and investor eligibility; only then open subscriptions in Settings.
7. Previous owner actions remain (Soroban RPC provider, Horizon provider, `RESTRICTED_COUNTRIES`, `LEGAL_*`, optional controlled Mainnet tests with your own funds).
