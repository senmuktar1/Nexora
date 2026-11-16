# NEXORA security model

## Keys
- Generated/imported in the browser; encrypted with PBKDF2-SHA256 (600k) → AES-256-GCM, public key bound as AAD; stored in IndexedDB (`nexora-wallet`).
- Decrypted keypair exists only in memory while unlocked (auto-lock 15 min, lock on page hide). Never sent to any server.
- Per-wallet records (voucher links, launched-asset issuer keys) are encrypted with an HKDF-derived key from the wallet seed.
- Delete Account deletes the whole database and NEXORA browser storage.

## Signing
- Only `WalletProvider.signTransaction` can sign; modules cannot import the session (lint-enforced).
- Every transaction is checked by `src/lib/stellar/tx-guard.ts` against an intent the module derives from what the user entered: Mainnet passphrase, source, every operation (type, effective source, assets by code+issuer, amounts in stroops, destinations, claim predicates, contract + function + exact argument XDR), fee cap, validity window, memo, canonical XDR, no existing signatures.
- The approval sheet is decoded from the exact XDR that will be signed (`src/lib/stellar/describe.ts`); the same string is signed after explicit approval, and the signed hash is re-checked.
- Server-built Soroban transactions (Blend) are accepted only if their call arguments match the client's own encoding byte-for-byte.

## Submission
- `/api/stellar/submit` relays signed Mainnet envelopes to Horizon and reports success only after ledger confirmation; failure codes are mapped to fixed messages.

## Server
- All routes return generic errors; details are logged as JSON with request IDs and redaction (`src/lib/server/errors.ts`).
- Soroban features require `STELLAR_MAINNET_SOROBAN_RPC_URL`, verified at runtime (HTTPS, Mainnet passphrase, healthy). No fallback endpoint.
- Outbound fetches to issuer domains (stellar.toml, icons) are SSRF-hardened: HTTPS, domain validation, public resolved addresses only, no redirects, size caps; icons are raster-only by magic bytes.
- Strict CSP (`connect-src 'self'`, `img-src 'self' data: blob:`), frame-ancestors none, HSTS, nosniff.

## Additions (final release)
- **Relay checks:** the submit route verifies signatures before relaying. The transaction source must sign, and every signature must be valid for an account the transaction involves.
- **Duplicate submissions:** a recently seen hash is never re-sent; the known outcome is returned. A `tx_bad_seq` rejection is checked against the ledger, so a retry of an already-confirmed transaction is never reported as failed.
- **Soroban token:** the token code is pinned by SHA-256 (`NEXORA_TOKEN_WASM_HASH`). The browser refuses mismatched wasm, the prepare route accepts only that code (deployed by the transaction's own source), and the guard checks the wasm hash, deployer, salt and every constructor argument. The approval sheet shows the predicted contract ID, which a Soroban-host test vector cross-checks.
- **DeFindex:** vaults must be listed by DeFindex and answer `get_assets()`. Deposit and withdraw arguments are re-encoded by the browser and must match byte for byte. Slippage minimums are always non-zero.
- **Regional controls:** `RESTRICTED_COUNTRIES` (empty by default) reads only the platform's own geo header. Rate limiting likewise reads only the platform's own client-IP header, so neither can be spoofed by clients.

## Accounts, RWA programme and admin portal

- **Separation from the wallet.** Accounts (email + password) are for RWA applications, reviews and subscriptions only. Wallet keys never leave the browser and are never sent to the server; accounts store at most a public `G…` address. The server never signs Stellar transactions: issuance, trustline authorisation and delivery are signed in the issuer's own wallet after the approval sheet.
- **Database.** PostgreSQL accessed only from server code (`server-only`) with `DATABASE_URL`. Row-level security is enabled on every table with no policies, and Supabase's `anon`/`authenticated` roles are revoked. No database keys exist in the browser bundle.
- **Passwords:** scrypt (N=2^15, r=8, p=1, per-user salt), constant-time comparison, timing-equalised for unknown accounts. Minimum 12 characters.
- **Sessions:** random 256-bit tokens stored only as SHA-256 hashes; `__Host-` cookies (HttpOnly, Secure, SameSite=Strict, host-only, Path=/). Admin: 30 min idle / 8 h absolute. Suspension and recovery actions revoke sessions.
- **CSRF:** every state-changing request must carry an `Origin` matching the host (plus SameSite=Strict).
- **Throttling:** database-backed lockout (5 failures / 15 min per email, 30 per IP) plus per-route rate limits.
- **Admin access:** only on `ADMIN_HOST` (404 elsewhere, enforced in the proxy, the admin layout and every admin API). The Super Admin is created once, only for the server-side `NEXORA_ADMIN_EMAIL`, after proving both mailbox control (emailed link) and the chosen password, then enrolling TOTP MFA (mandatory; replay-protected; 10 single-use recovery codes). A unique index allows a single Super Admin; a one-row table closes bootstrap permanently. If `NEXORA_ADMIN_EMAIL` changes, the existing Super Admin is locked out rather than transferred; migration is an explicit, audited CLI step.
- **Authorization:** permission checks on the server for every admin route (role → permission map). Public sign-up can only create plain `user` accounts in a separate realm; there is no role field anywhere a user can set.
- **Documents:** PDF/PNG/JPEG only, verified by content (magic bytes), ≤ 4 MB, sanitised filenames, AES-256-GCM encryption at rest bound to the document ID (HKDF sub-key from `DATA_ENCRYPTION_KEY`), SHA-256 integrity check on download, served as attachments with `nosniff` and a sandbox CSP. Access: owner, MFA-verified admins (logged), or anyone only for documents explicitly published with a listed, issued offering.
- **Review integrity:** status changes are conditional updates (no lost updates) recorded with history and an append-only audit log (actor, action, previous/new status, reason). Verified findings must cite a document. Issuer declarations and verified evidence are labelled separately everywhere.
- **Tokenization:** approval and final authorization are separate steps. Authorization requires every system check (approval, offering documents, verified issuer/ownership/valuation findings, a legal opinion / regulatory clearance **document** recorded as verified by a reviewer, submitted configuration, distribution address match, on-chain transfer controls) and every reviewer confirmation (that verified document selected, a descriptive counsel/regulator reference, configuration matches offering, issuer authorised, explicit Mainnet authorization), and expires. A typed reference alone is never accepted as legal clearance; the authorization record stores the document ID and SHA-256.
- **On-chain verification:** issuance, trustline authorisation and delivery are each checked independently against exactly one acceptable shape (`checkIssuanceOps`, `checkTrustlineAuthorizationOps`, `checkDeliveryOps` in `src/lib/server/rwa.ts`): transaction source, exact operation count and order, each operation's source, destination, asset, amount and flags. Issuance = create_account (D→new issuer I, 1.5 XLM) · set_options (I; flags exactly required+revocable[+clawback]; no signers, thresholds, home domain, master weight or cleared flags) · change_trust (D) · set_trust_line_flags (I authorises D) · payment (I→D, total supply). Authorisation = one set_trust_line_flags (I authorises the investor). Delivery = one payment (D→investor, subscribed amount). Any additional or different operation is refused. Horizon's `operation_count` must be present, a positive integer, and equal to the operations returned. A transaction hash can be recorded for only one step, globally: it is reserved in `rwa_recorded_transactions` (primary key) in the same database transaction as the status change, event and audit entry, so concurrent attempts to reuse a hash (any step, application or subscription) can't both succeed, and a failed recording leaves no reservation behind. Partial unique indexes on the hash columns back this up.
- **Error display:** the browser only shows error text from responses carrying `X-Nexora-Message: 1` (written by this server); anything else becomes a generic message.
