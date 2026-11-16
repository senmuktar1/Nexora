# NEXORA — Deployment Guide (Vercel and Netlify)

This guide deploys NEXORA from this source to a **new** Vercel or Netlify account. Nothing in the source depends on a previous account, deployment URL or development machine.

**What was verified for this release** (details in `NEXORA-FINAL-HANDOVER.md`). The table below is from the previous release; this release was re-verified with `vercel build` and the full browser suite against `next start` (see the handover for exact results):

| | Vercel | Netlify |
|---|---|---|
| Platform build tool run on a clean copy of the source | ✅ `vercel build` (CLI 65.16.0) | ✅ `netlify build` (CLI 27.19.0, Next.js Runtime 5.16.6) |
| Production build served by the platform tooling + full browser suite | — (Vercel has no local serve of build output) | ✅ `netlify serve` emulation: all suites passed |
| Real deployment to the platform | ❌ not performed (requires your account) | ❌ not performed (requires your account) |

---

## 1. Requirements

- **Node.js 22** (`"engines": { "node": "22.x" }`). Both platforms read this automatically.
- **Next.js 16** route handlers on the **Node.js** runtime, plus one **proxy** (`src/proxy.ts`) for optional regional restrictions.
- **HTTPS**, which both platforms provide automatically. The browser wallet needs it (Web Crypto).
- **PostgreSQL 15+** (Supabase recommended) for NEXORA accounts, the RWA programme and the admin portal. Without it those features show "not available on this deployment" and everything else works.
- **Transactional email** (Resend) for account and administrator email verification.
- **A second hostname** for the private admin portal, e.g. `admin.nexora.com`, on the same project.
- No object storage and no cron: documents are stored encrypted in the database.

## 2. Before you start

1. Create the new Vercel or Netlify account (with 2-factor authentication).
2. Push this source to a **new Git repository**. The release branch is **`feature/rwa-admin`** (it contains the full history, including the earlier wallet release); deploy it as your `main` branch:
   ```bash
   git clone -b feature/rwa-admin NEXORA-FINAL-GIT.bundle nexora
   cd nexora && git remote add origin <your-new-repo-url> && git push -u origin feature/rwa-admin:main
   ```
   Alternatively, unzip `NEXORA-FINAL-SOURCE.zip` (identical content) and push it. Don't deploy any older branch: it lacks the accounts, RWA programme and admin portal.
3. *(Optional)* In `src/lib/site.ts`, set `repositoryUrl` to your repository, or to `null` to hide source links.
4. Choose a **Soroban RPC provider** for the smart-contract features: <https://developers.stellar.org/docs/data/rpc/providers>. Create a **Mainnet** endpoint.
5. *(Recommended for production traffic)* choose a **Horizon provider**: <https://developers.stellar.org/docs/data/apis/horizon/providers>.

## 3. Environment variables

The full descriptions are in `.env.example`. All variables are **server-side** and none is exposed to the browser. Set them for **Production**, and also for **Preview** if you use preview deployments.

| Variable | Required | Secret | Enables |
|---|---|---|---|
| `STELLAR_MAINNET_SOROBAN_RPC_URL` | **Yes** for smart-contract features | Yes, if it contains a key | Blend lending, DeFindex vaults, Soroban token deployment |
| `STELLAR_HORIZON_URL` | No (defaults to SDF Horizon) | Yes, if it contains a key | All classic Stellar data and transactions |
| `STELLAR_EXPERT_API_KEY` | No | Yes | Explore movers / new assets |
| `DEFINDEX_API_KEY` | No | Yes | Detailed vault metadata |
| `RESTRICTED_COUNTRIES` | No (owner/legal decision) | No | Regional blocking |
| `GEO_COUNTRY_HEADER` | No (leave empty on Vercel/Netlify) | No | Country header for self-hosting |
| `TRUSTED_CLIENT_IP_HEADER` | No (leave empty on Vercel/Netlify) | No | Client IP for rate limiting |
| `LEGAL_OPERATOR_NAME`, `LEGAL_CONTACT_EMAIL`, `LEGAL_GOVERNING_LAW`, `LEGAL_EFFECTIVE_DATE` | No | No | Legal documents |
| `LEGAL_DOCS_APPROVED` | No (`true` only after counsel review) | No | Removes the "draft" label |
| `HSTS_PRELOAD` | No | No | HSTS preload directive |
| `DATABASE_URL` | **Yes** for accounts/RWA/admin | **Yes** | PostgreSQL connection (§3a) |
| `DATABASE_POOL_MAX` | No (default 5) | No | Connections per server instance |
| `DATA_ENCRYPTION_KEY` | **Yes** for accounts/RWA/admin | **Yes** | Encrypts documents and admin MFA secrets (§3a) |
| `ADMIN_HOST` | **Yes** for the admin portal | No | Hostname serving `/admin` (§3b) |
| `NEXORA_ADMIN_EMAIL` | **Yes** for the admin portal | **Private** | The only email that can become Super Admin (§3b) |
| `RESEND_API_KEY`, `EMAIL_FROM` | **Yes** for email verification | Key: **Yes** | Verification emails (§3c) |
| `EMAIL_TEST_OUTBOX` | **Never in production** | No | Local automated tests only; ignored on Vercel/Netlify |

**Never** put a Stellar secret key (`S…`) in any variable. NEXORA never needs one. **Never** use a Supabase `anon`/`service_role` key or any `NEXT_PUBLIC_` variable for the database: NEXORA talks to PostgreSQL only from the server.

### 3a. Database (Supabase) and migrations

1. Create a Supabase project (choose a region near your hosting region). Save the database password in your password manager.
2. **Project → Connect → Transaction pooler**: copy the URI (port `6543`) and insert your password. This is `DATABASE_URL`.
3. Generate the encryption key on your own computer and store a copy offline (losing it makes stored documents and MFA enrolments unreadable):
   ```bash
   openssl rand -base64 32
   ```
   This is `DATA_ENCRYPTION_KEY`. Don't change it after go-live.
4. Apply the schema from your computer (Node 22, in the project folder, after `npm ci`):
   ```bash
   DATABASE_URL='postgresql://…:6543/postgres' npm run db:migrate
   ```
   It prints `+ 0001_init.sql` and `+ 0002_tx_hash_uniqueness.sql` the first time and `=` for each afterwards (safe to re-run). If you already applied `0001` from an earlier delivery, running it again applies only `0002`. Run it again after every upgrade that adds files to `db/migrations/`, **before** deploying the new code.
5. Security model: every table has row-level security enabled with **no policies**, and `anon`/`authenticated` are revoked, so Supabase's public REST/GraphQL APIs can't read or write anything. Only the server, using `DATABASE_URL`, can. Don't add RLS policies or expose the tables through the Supabase API.
6. Backups: enable Supabase's daily backups (and PITR if your plan allows). Documents live in the `rwa_documents` table (encrypted).

Any PostgreSQL 15+ works the same way (Neon, RDS, self-hosted): set `DATABASE_URL` and run the migration.

### 3b. Admin portal and one-time Super Admin setup

1. Add the admin hostname to the **same** project: Vercel → Settings → Domains → add `admin.nexora.com` (Netlify: Domain management → add domain alias). Create the DNS record shown.
2. Set `ADMIN_HOST=admin.nexora.com` and `NEXORA_ADMIN_EMAIL=<your email>` (Production scope; mark the email **Sensitive**). Redeploy.
3. What the separation does: on `ADMIN_HOST` only the portal is served; on every other hostname `/admin` and `/api/admin/*` return 404. Admin session cookies are host-only (`__Host-`), so they are never sent to the public site.
4. **Bootstrap (once):** open `https://admin.nexora.com`. You'll see **Set up administration**.
   1. Enter `NEXORA_ADMIN_EMAIL` and a password (12+ characters). Any other email is refused and logged.
   2. Open the link emailed to you **and enter the same password** (both are required, so neither a leaked link nor a guessed email is enough).
   3. Scan the QR code with an authenticator app, enter the 6-digit code, and store the 10 recovery codes offline.
   4. Setup is then permanently closed (recorded in `admin_bootstrap`; the database also allows only one Super Admin).
5. **Daily sign-in:** email + password, then a 6-digit authenticator code (or a single-use recovery code). Sessions expire after 30 minutes idle / 8 hours total. Five wrong passwords lock the email for 15 minutes.
6. **There is no public admin registration, no role choice and no way to promote an account from the website.** Staff roles (`reviewer`, `compliance`) exist in the permission model for future use and can only be created by a future, deliberately added admin feature or directly in the database.

**Changing the admin email, lost authenticator, forgotten password** — run from your computer with `DATABASE_URL` (every action is audited; nothing is transferred silently):

```bash
DATABASE_URL='…' npm run admin:recovery -- status
DATABASE_URL='…' npm run admin:recovery -- change-email --from old@example.com --to new@example.com --confirm
DATABASE_URL='…' npm run admin:recovery -- reset-mfa --email you@example.com --confirm
DATABASE_URL='…' npm run admin:recovery -- reset-password --email you@example.com --confirm
DATABASE_URL='…' npm run admin:recovery -- unlock --email you@example.com
```

After `change-email`, set `NEXORA_ADMIN_EMAIL` to the new address and redeploy. If you only change the variable (without the command), **nobody** can sign in until they match — access is never handed to the new address automatically.

### 3c. Email (Resend)

1. Create a Resend account, add and verify your sending domain (DNS records), create an API key with "Sending access".
2. Set `RESEND_API_KEY` (Sensitive) and `EMAIL_FROM`, e.g. `NEXORA <no-reply@nexora.com>`.
3. Without email configured, sign-up and admin setup show "Email delivery isn't configured".

---

## 4. Deploy on Vercel

1. **Add New → Project** → import your new repository.
2. Framework preset: **Next.js** (auto-detected). Keep the defaults:
   - Install command: `npm ci` (or the default)
   - Build command: `npm run build` (or the default)
   - Output: Next.js default
   - Node.js version: comes from `package.json` (22.x)
3. **Environment Variables:** add the variables from section 3. Mark the secret ones as **Sensitive**.
4. **Deploy.**
5. **Settings → Functions:** keep **Fluid Compute** enabled, and don't set a project-wide maximum duration below 30 s. The Soroban routes declare `maxDuration = 30`, and `vercel build` confirmed this is applied.
6. **Domains:** add your domain and create the DNS records Vercel shows (CNAME for subdomains, A for apex). HTTPS is issued automatically.
7. Run the checks in section 6.

What `vercel build` confirmed for this source:

- Every API route is a Node.js function.
- `maxDuration`: 30 s on the Blend/DeFindex/Soroban routes and 15 s on submit.
- The proxy is deployed as middleware.
- The security headers (including CSP) are in the routing config.

**Regional restrictions on Vercel:** set `RESTRICTED_COUNTRIES`. The country comes from Vercel's `x-vercel-ip-country` header automatically.

## 5. Deploy on Netlify

1. **Add new site → Import an existing project** → choose your new repository.
2. Netlify reads `netlify.toml`: build `npm run build`, publish `.next`, Node 22. Netlify detects Next.js and applies its **Next.js Runtime** automatically; don't add a separate plugin.
3. **Site configuration → Environment variables:** add the variables from section 3, with scopes **Builds**, **Functions** and **Runtime**. Mark secret values as secret.
4. **Deploy site.**
5. **Domain management:** add your domain and follow Netlify's DNS instructions. HTTPS (Let's Encrypt) is automatic.
6. Run the checks in section 6.

**Netlify limitation you must check:** synchronous function execution time.

- NEXORA's Blend/DeFindex/Soroban routes (simulations against your RPC) may take longer than **10 seconds**, which several Netlify sources cite as the default limit. Netlify ignores `maxDuration`.
- All other routes are designed to finish in under 10 s. Transaction submission returns within about 8 s and then confirms from the browser.
- If smart-contract actions show "temporarily unavailable" or time out, ask Netlify support to raise the function timeout for your site (some plans allow up to 26 s), or deploy on Vercel.

**Regional restrictions on Netlify:** the proxy runs as a Netlify edge function. It reads the country from Netlify's `x-country` header and `RESTRICTED_COUNTRIES` from your environment variables.

---

## 6. Post-deployment verification

```bash
D=https://your-domain.example
curl -sf $D/api/health                                  # {"ok":true,...}
curl -s  $D/api/health?deep=1                           # horizon.mainnet:true; soroban.verified:true when RPC set
curl -sI $D/ | grep -iE "content-security-policy|strict-transport-security|x-frame-options|x-content-type-options|referrer-policy"
curl -s -o /dev/null -w "%{http_code}\n" "$D/api/stellar/network?network=testnet"   # 400 (Mainnet only)
curl -s "$D/api/stellar/assets?code=USDC" | head -c 300                              # live asset data
curl -s -o /dev/null -w "%{http_code}\n" $D/admin                                   # 404 (portal not on the public host)
curl -s -o /dev/null -w "%{http_code}\n" $D/api/admin/auth/status                   # 404
A=https://admin.your-domain.example
curl -s $A/api/admin/auth/status                                  # {"ready":{"database":true,"encryption":true,"email":true,"adminEmail":true},...}
curl -s -o /dev/null -w "%{http_code}\n" $A/api/stellar/network   # 404 (admin host serves only the portal)
```

`/api/health?deep=1` also reports `platform.database.{configured,reachable,migrated}`, `platform.encryption`, `platform.email` and `platform.admin.{host,email,bootstrapCompleted}` as booleans.

In a browser, on desktop and phone, in light and dark themes:

1. Pages load with no console errors. **Explore** shows live market data.
2. **Wallet:**
   - Create a fresh wallet; you see the backup screen, then set a password.
   - Lock and unlock work.
   - Delete Account wipes it, and **Import** with the secret key restores the same address.
3. **Swap:** a live quote appears, and **Review swap** opens the approval sheet. Reject it; nothing is submitted.
4. **Lend:** Blend markets load (requires the RPC). The DeFindex vault drawer shows your position. **Explore vaults → View details**.
5. **Launch → Soroban Token:** the steps show "Deploy token". Stop before approving unless you intend to deploy.
6. **Asset directory → Check issuer:** on-chain evidence is shown.
7. **Legal pages** (`/terms`, `/privacy`, `/risk-disclosure`, `/wallet-security`, `/restricted-regions`) show your `LEGAL_*` settings.
8. **Admin portal:** complete the bootstrap (§3b), sign out, sign in again with password + code. Confirm a second browser on the public site gets 404 at `/admin`.
9. **Accounts and RWA:** on the public site create an account with a second email, confirm it, start an application at **RWA → Tokenize an asset**, upload a small PDF, and submit. In the admin portal: open it, start review, record a finding, request information; the applicant sees the request. (Use test data; reject the test application afterwards with a reason.)
10. **Settings:** subscriptions are **closed** by default. Open them only when your counsel has cleared the offerings you list.

**Production verification checklist (sign off each):**

| # | Check | Expected |
|---|---|---|
| 1 | `/api/health?deep=1` | `horizon.mainnet:true`; `platform.database.migrated:true`; `platform.encryption:true`; `platform.email:"configured"`; `platform.admin.host:true` |
| 2 | Public `/admin`, `/api/admin/*` | 404 |
| 3 | Admin host other paths | redirect to `/admin`; `/api/stellar/*` 404 |
| 4 | Bootstrap with a different email | refused; appears in Audit log as `admin.bootstrap.rejected` |
| 5 | Bootstrap with your email | link + password + authenticator; then setup is closed |
| 6 | Sign-in | password + TOTP; wrong code refused; recovery code works once |
| 7 | Cookies (browser devtools) | `__Host-nx_admin` on the admin host only; HttpOnly, Secure, SameSite=Strict |
| 8 | Application → review → decision | statuses and reasons appear for the applicant; Audit log records actor, statuses and reason |
| 9 | Documents | only the owner and admins can download; offering documents public only when you tick "Publish with offering" on a listed offering |
| 10 | Tokenization | "Authorise issuance" refuses until every check passes — including a legal opinion / regulatory clearance **document** recorded as verified under Findings (a typed reference alone is refused); issuance happens only from the issuer's own wallet |
| 11 | Wallet features | unchanged (create/import/lock/delete, swap, vouchers, launch, lend) |
| 12 | Supabase API | `curl https://<project>.supabase.co/rest/v1/app_users -H "apikey: <anon key>"` returns no rows / permission error |

**Controlled Mainnet transaction (only with your own funds, when you choose):** use a fresh wallet with a few XLM. Pay 1 XLM to a second wallet you control via `/pay/<address>`, and confirm:

- the approval sheet matches what you entered
- the UI shows success only after confirmation
- `/receipt/<hash>` and Stellar Expert show the same transaction

Do the same for one small swap, one voucher (create, then redeem with the second wallet) and, if wanted, one small Blend or DeFindex action.

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `/api/health?deep=1` → `soroban.configured:false` | `STELLAR_MAINNET_SOROBAN_RPC_URL` isn't set for the running environment (check its scope). Redeploy after setting it. |
| `soroban.configured:true, verified:false` | The RPC is unreachable, not Mainnet, or unhealthy. Check the provider dashboard and URL. Logs show scope `soroban-rpc:verify`. |
| `horizon.reachable:false` or HTTP 429s in logs | Horizon unreachable or rate-limited. Set `STELLAR_HORIZON_URL` to a provider endpoint. |
| Lending / vault / token actions time out (Netlify) | Function time limit; see section 5. |
| Wallet missing after changing domain | Wallets are stored per origin. Import the secret key on the new domain. |
| Everyone appears restricted, or no one is | Check `RESTRICTED_COUNTRIES` uses ISO alpha-2 codes. On self-hosted setups set `GEO_COUNTRY_HEADER`. |
| CSP errors after adding a third-party script | Intended: the CSP only allows the site's own origin. Change `next.config.ts` deliberately if you add one. |
| Server errors in logs | JSON lines with `scope` and `requestId`. Secrets, tokens and query strings are redacted. Users only see short messages. |
| "Accounts aren't available yet: the database isn't configured" | `DATABASE_URL` not set for this environment. |
| "Secure storage isn't configured yet" | `DATA_ENCRYPTION_KEY` missing or not 32 bytes (base64). |
| Health: `database.reachable:false` | Wrong password/host, or pooler URL missing. Use the Transaction pooler URI. |
| Health: `database.migrated:false` | Run `npm run db:migrate` with the production `DATABASE_URL`. |
| Admin host shows the public site / 404 | `ADMIN_HOST` doesn't exactly match the hostname, or the domain isn't added to this project. |
| Admin sign-in always fails after changing `NEXORA_ADMIN_EMAIL` | Intended. Run `admin:recovery change-email` (§3b). |
| Verification email never arrives | Check `RESEND_API_KEY`, `EMAIL_FROM` domain verification and Resend logs. |

## 8. Other hosts

A production `Dockerfile` is included (Node 22, non-root, HEALTHCHECK). It was tested by building and running the image. Any container or Node host works: `npm ci && npm run build && npm start`. Cloudflare Workers is **not** compatible: its `node:dns` lacks `lookup`, which the SSRF protection requires.
