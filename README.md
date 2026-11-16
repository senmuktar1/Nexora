# NEXORA

**A non-custodial financial terminal for Stellar Mainnet.**
Emerald & Graphite. Swap, lend, issue assets, send vouchers and check issuers, all with a wallet whose keys never leave your browser.

## Features

| Module | What it does |
|---|---|
| **Wallet** | Create or import a Stellar key in the browser, encrypted with your password (PBKDF2-SHA256 → AES-256-GCM) in IndexedDB. Lock/unlock, auto-lock, and Delete Account (local wipe). |
| **Trading** | Asset search by code + issuer, live order book and trades, Stellar DEX path-payment swaps with slippage protection, automatic trustlines, and verified issuer icons. |
| **Vouchers** | Claimable-balance gift cards: create 1–50, share by link or QR, redeem, block duplicate redemption, delayed unlock, and refund after expiry. |
| **Launchpad** | Classic Stellar assets (issuer controls, vesting tranches, Stellar DEX listing, fixed supply, `stellar.toml`) **and** Soroban SEP-41 tokens (OpenZeppelin-based fixed-supply contract in `contracts/nexora-token`). |
| **Lending & yield** | Blend pools (supply, withdraw, borrow, repay) and DeFindex vaults (position, deposit, withdraw). Each transaction is built and simulated on the server, and the browser verifies the call arguments byte for byte. |
| **RWA programme** | Issuers apply to tokenize real-world assets (8 categories) with encrypted supporting documents; NEXORA reviews (findings: issuer declaration vs verified evidence, information requests, approve/reject/suspend); a separate final authorization unlocks issuance of a restricted classic Stellar asset (authorization required + revocable + clawback) from the issuer's own wallet; the server verifies it on-chain. Public offerings explorer with risk disclosure, subscriptions (request → accept → trustline → issuer authorisation → delivery), redemption requests and lifecycle reporting. |
| **Issuer evidence** | On-chain controls and supply, SEP-1 domain link, and issuer-published claims clearly labelled as unverified (`/assets`). |
| **Admin portal** | Private portal on its own host (`ADMIN_HOST`, e.g. `admin.nexora.com`): one-time Super Admin bootstrap bound to the server-side `NEXORA_ADMIN_EMAIL`, email verification, mandatory TOTP MFA, review queues, tokenization authorization, assets, users, audit log and settings. |

Every transaction passes a **pre-sign guard** and a **wallet approval sheet** decoded from the exact XDR being signed. Success is shown only after ledger confirmation. See [`docs/SECURITY.md`](docs/SECURITY.md).

## Architecture

- Next.js 16 (App Router) + React 19 + TypeScript, Tailwind 4 design tokens
- `@stellar/stellar-sdk` 17, `@blend-capital/blend-sdk`
- Server route handlers (`src/app/api/stellar/*`) relay public data from Stellar Horizon, a Soroban RPC, StellarExpert and DeFindex, and relay signed transactions. The browser talks only to its own origin (CSP `connect-src 'self'`).
- PostgreSQL (Supabase-compatible) for accounts, RWA applications, encrypted documents, reviews and the audit log, accessed only from the server (`DATABASE_URL`, `postgres` driver). Schema in `db/migrations`, applied with `npm run db:migrate`. Without a database the wallet/trading features work and the account/RWA/admin features report that they're unavailable.

## Quick start

```bash
cp .env.example .env.local     # optional for local use; see comments inside
npm ci
npm run dev                    # http://localhost:3000
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run build` / `npm start` | Production build and server (`$PORT`, default 3000) |
| `npm run typecheck` · `npm run lint` · `npm test` | TypeScript, ESLint, Vitest unit/integration tests |
| `npm run test:e2e` | Playwright browser acceptance suite against a running server on :3100 (see `e2e/lib.mjs`; the RWA/admin suite's setup is in `.github/workflows/ci.yml`) |
| `npm run db:migrate` | Apply database migrations (`DATABASE_URL`) |
| `npm run admin:recovery -- <command>` | Owner-only recovery: Super Admin email change, MFA reset, password reset, unlock (audited) |

Database integration tests run when `TEST_DATABASE_URL` points to a disposable PostgreSQL database (they create `<db>_admin` and `<db>_rwa` databases); otherwise they are skipped.

## Deployment

See **[`NEXORA-FINAL-DEPLOYMENT-GUIDE.md`](NEXORA-FINAL-DEPLOYMENT-GUIDE.md)**. It covers compatible hosts, environment variables, Horizon/Soroban RPC setup, domain and HTTPS, security configuration and post-deployment checks. A production `Dockerfile` is included.

## Status

See [`NEXORA-FINAL-HANDOVER.md`](NEXORA-FINAL-HANDOVER.md) for verification evidence and known limitations.

Never commit private keys, seed phrases or provider secrets. Never ask users to share wallet secrets.
