// RWA programme + admin portal acceptance (production build, real browser, real PostgreSQL).
// Real UI, accounts, sessions, MFA, uploads, review, authorization, wallet, guard and
// approval sheet. Browser-side Stellar API responses are MOCKED (nothing is broadcast);
// the server's on-chain verification runs against a local mock Horizon fed with the exact
// transactions the browser signed.
//
// Server env: DATABASE_URL, ADMIN_HOST=admin.localhost, NEXORA_ADMIN_EMAIL=founder@example.com,
// DATA_ENCRYPTION_KEY, EMAIL_TEST_OUTBOX=true, STELLAR_HORIZON_URL=https://localhost:8443
// (+ NODE_EXTRA_CA_CERTS for the mock's certificate). Test env: E2E_DATABASE_URL, MOCK_HORIZON_URL.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { createRequire } from "node:module";
import { BASE, createWallet, loadPlaywright, reporter } from "./lib.mjs";
const require = createRequire(import.meta.url);
const { Networks, TransactionBuilder, Keypair } = require("@stellar/stellar-sdk");
const postgres = require("postgres");
const { chromium } = loadPlaywright();
const rep = reporter();

const port = new URL(BASE).port || "80";
const ADMIN = `http://admin.localhost:${port}`;
const FOUNDER = "founder@example.com";
const PW = "correct horse battery staple";
const sql = postgres(process.env.E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
const MOCK = process.env.MOCK_HORIZON_URL ?? "https://localhost:8443";
const MOCK_CA = process.env.MOCK_HORIZON_CA ? readFileSync(process.env.MOCK_HORIZON_CA) : undefined;

const lastToken = async to => /token=([A-Za-z0-9_-]+)/.exec((await sql`select body from email_outbox where to_email = ${to} order by id desc limit 1`)[0]?.body ?? "")?.[1];
const b32 = s => { const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const out = []; for (const c of s) { v = ((v << 5) | A.indexOf(c)) & 0xffff; bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const totp = (secret, step = Math.floor(Date.now() / 30000)) => { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(step)); const m = createHmac("sha1", b32(secret)).update(c).digest(); const o = m[m.length - 1] & 15; return String((m.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0"); };
const PDF = name => ({ name, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.7\n${name}\n%%EOF`) });

/** Horizon-shaped records for a signed transaction (what the mock serves to the server). */
function horizonFixtures(tx, issuerFlags) {
  const hash = Buffer.from(tx.hash()).toString("hex");
  const flagList = n => [1, 2, 4, 8].filter(f => (n ?? 0) & f);
  const records = tx.operations.map(op => {
    const src = op.source ?? tx.source;
    switch (op.type) {
      case "createAccount": return { type: "create_account", source_account: src, funder: src, account: op.destination, starting_balance: op.startingBalance };
      case "setOptions": return { type: "set_options", source_account: src, set_flags: flagList(op.setFlags), ...(op.masterWeight !== undefined ? { master_key_weight: op.masterWeight } : {}) };
      case "changeTrust": return { type: "change_trust", source_account: src, trustor: src, asset_code: op.line.code, asset_issuer: op.line.issuer };
      case "setTrustLineFlags": return { type: "set_trust_line_flags", source_account: src, trustor: op.trustor, asset_code: op.asset.code, asset_issuer: op.asset.issuer, set_flags: op.flags.authorized ? [1] : [] };
      case "payment": return { type: "payment", source_account: src, from: src, to: op.destination, asset_code: op.asset.code, asset_issuer: op.asset.issuer, amount: op.amount };
      default: return { type: op.type, source_account: src };
    }
  });
  const fx = { [`/transactions/${hash}`]: { successful: true, source_account: tx.source, hash, operation_count: records.length }, [`/transactions/${hash}/operations?limit=200`]: { _embedded: { records } } };
  if (issuerFlags) fx[`/accounts/${issuerFlags.issuer}`] = { id: issuerFlags.issuer, flags: { auth_required: true, auth_revocable: true, auth_clawback_enabled: true }, signers: [{ key: issuerFlags.issuer, weight: 1 }] };
  return fx;
}
const postFixtures = fx => new Promise((resolve, reject) => {
  const req = httpsRequest(`${MOCK}/__fixtures`, { method: "POST", ca: MOCK_CA, servername: "localhost" }, res => { res.resume(); res.on("end", resolve); });
  req.on("error", reject);
  req.end(JSON.stringify(fx));
});

/** Browser-side Stellar API mock with per-address accounts and captured submissions. */
function mockStellar(page, state) {
  return page.route("**/api/stellar/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/stellar/account") {
      const id = url.searchParams.get("address");
      const acct = state.accounts[id];
      if (!acct) return route.fulfill({ status: 404, json: { error: "Account not found." } });
      return route.fulfill({ json: { account: { account_id: id, sequence: String(acct.seq), subentry_count: 0, num_sponsoring: 0, num_sponsored: 0 }, balances: acct.balances } });
    }
    if (url.pathname === "/api/stellar/fee") return route.fulfill({ json: { perOperation: 100 } });
    if (url.pathname === "/api/stellar/submit") {
      const tx = TransactionBuilder.fromXDR(route.request().postDataJSON().xdr, Networks.PUBLIC);
      state.submitted.push(tx);
      const created = tx.operations[0]?.type === "createAccount" ? tx.operations[0].destination : null;
      await postFixtures(horizonFixtures(tx, created ? { issuer: created } : undefined));
      return route.fulfill({ json: { status: "confirmed", hash: Buffer.from(tx.hash()).toString("hex") } });
    }
    return route.fulfill({ status: 502, json: { error: "Temporarily unavailable." } });
  });
}

/** Unlocks the wallet if the page asks (reloads re-lock it, as in real use). */
async function maybeUnlock(page, timeout = 4000) {
  const unlockDialog = page.getByRole("dialog", { name: "Wallet" });
  if (await unlockDialog.waitFor({ timeout }).then(() => true, () => false)) {
    await unlockDialog.getByLabel("Password").fill("correct horse battery");
    await unlockDialog.getByRole("button", { name: /Unlock/ }).click();
  }
}
/** Waits for the approval sheet (unlocking first if needed), then approves after the anti-clickjack delay. */
async function approveSheet(page) {
  const sheet = page.getByRole("dialog", { name: "Approve transaction" });
  await Promise.race([sheet.waitFor().catch(() => undefined), maybeUnlock(page, 30000)]);
  await sheet.waitFor();
  const text = await sheet.innerText();
  await page.waitForTimeout(700);
  await sheet.getByRole("button", { name: /Approve/ }).click();
  return text;
}

const browser = await chromium.launch();
try {
  /* ───────── 1. Host separation ───────── */
  const pub = await browser.newPage();
  const r404 = await pub.goto(`${BASE}/admin`);
  rep.check("public host: /admin is 404", r404.status() === 404);
  const api404 = await pub.request.get(`${BASE}/api/admin/auth/status`);
  rep.check("public host: /api/admin/* is 404", api404.status() === 404);
  const adminOther = await pub.goto(`${ADMIN}/api/stellar/network`);
  rep.check("admin host serves no public APIs", adminOther.status() === 404);

  /* ───────── 2. Founder bootstrap + MFA ───────── */
  const admin = await (await browser.newContext({ viewport: { width: 1360, height: 950 } })).newPage();
  await admin.goto(`${ADMIN}/`);
  rep.check("admin host root opens the portal", admin.url().endsWith("/admin"));
  await admin.getByRole("heading", { name: "Set up administration" }).waitFor();
  const html = await admin.content();
  rep.check("configured admin email is not in the page", !html.includes(FOUNDER));
  await admin.getByLabel("Administrator email").fill("intruder@example.com");
  await admin.getByLabel("Password", { exact: true }).fill(PW);
  await admin.getByLabel("Confirm password").fill(PW);
  await admin.getByRole("button", { name: "Send confirmation link" }).click();
  await admin.getByText("This email can't be used to set up administration.").waitFor();
  rep.check("bootstrap rejects an unauthorised email", true);
  await admin.getByLabel("Administrator email").fill(FOUNDER);
  await admin.getByRole("button", { name: "Send confirmation link" }).click();
  await admin.getByText(/Check the inbox/).waitFor();
  await admin.goto(`${ADMIN}/admin/verify?token=${await lastToken(FOUNDER)}`);
  await admin.getByLabel("Password").fill(PW);
  await admin.getByRole("button", { name: "Confirm" }).click();
  await admin.getByRole("heading", { name: "Set up two-factor authentication" }).waitFor();
  await admin.getByRole("button", { name: "Start setup" }).click();
  const secret = (await admin.getByTestId("mfa-secret").textContent()).trim();
  rep.check("MFA QR code shown", await admin.getByAltText("Authenticator QR code").isVisible());
  await admin.getByLabel("6-digit code from the app").fill(totp(secret));
  await admin.getByRole("button", { name: "Turn on two-factor authentication" }).click();
  const codes = (await admin.getByLabel("Recovery codes", { exact: true }).textContent()).trim().split("\n");
  rep.check("10 recovery codes shown once", codes.length === 10);
  await admin.getByLabel(/I have stored these recovery codes/).check();
  await admin.getByRole("button", { name: "Open the admin portal" }).click();
  await admin.getByRole("heading", { name: "Overview" }).waitFor();
  rep.check("portal opens after MFA", true);
  const cookies = await admin.context().cookies();
  const c = cookies.find(x => x.name === "__Host-nx_admin");
  rep.check("admin cookie HttpOnly + SameSite=Strict + host-only", c && c.httpOnly && c.sameSite === "Strict" && c.domain === "admin.localhost");
  rep.check("bootstrap completed once in DB", (await sql`select count(*)::int n from admin_bootstrap`)[0].n === 1);

  // Sign out → sign in with password + TOTP.
  await admin.getByRole("button", { name: "Sign out" }).click();
  await admin.getByRole("heading", { name: "Administrator sign in" }).waitFor();
  rep.check("no bootstrap offered after setup", !(await admin.getByRole("button", { name: "First-time setup" }).count()));
  await admin.getByLabel("Email").fill("someone@example.com");
  await admin.getByLabel("Password").fill(PW);
  await admin.getByRole("button", { name: "Continue" }).click();
  await admin.getByText("Email or password is incorrect.").waitFor();
  rep.check("unauthorised email rejected at sign-in", true);
  await admin.getByLabel("Email").fill(FOUNDER);
  await admin.getByRole("button", { name: "Continue" }).click();
  await admin.getByRole("heading", { name: "Two-factor verification" }).waitFor();
  await new Promise(r => setTimeout(r, Math.max(0, 30_000 - (Date.now() % 30_000)) + 200)); // next TOTP step (no replay)
  await admin.getByLabel(/6-digit code/).fill(totp(secret));
  await admin.getByRole("button", { name: "Verify" }).click();
  await admin.getByRole("heading", { name: "Overview" }).waitFor();
  rep.check("sign-in with password + TOTP", true);

  /* ───────── 3. Issuer: account, wallet, application ───────── */
  const issuerCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const issuer = await issuerCtx.newPage();
  const chain = { accounts: {}, submitted: [] };
  await mockStellar(issuer, chain);
  await issuer.goto(`${BASE}/account`, { waitUntil: "networkidle" });
  await issuer.getByRole("tab", { name: "Create account" }).click();
  await issuer.getByLabel("Email").fill("issuer@example.com");
  await issuer.getByLabel(/^Password/).fill(PW);
  await issuer.getByLabel("Confirm password").fill(PW);
  await issuer.getByRole("button", { name: "Create account" }).click();
  await issuer.getByText(/Check your email/).waitFor();
  await issuer.goto(`${BASE}/account/verify?token=${await lastToken("issuer@example.com")}`);
  await issuer.getByLabel("Password").fill(PW);
  await issuer.getByRole("button", { name: "Confirm email" }).click();
  await issuer.getByRole("heading", { name: "Your account" }).waitFor();
  rep.check("public account created and verified", true);
  const { address: issuerWallet } = await createWallet(issuer);
  chain.accounts[issuerWallet] = { seq: 900, balances: [{ asset_type: "native", balance: "100.0000000", selling_liabilities: "0" }] };
  await issuer.getByRole("button", { name: "Link this wallet’s address" }).click();
  await issuer.getByText("Wallet address linked.").waitFor();

  await issuer.getByRole("link", { name: "New application" }).click();
  await issuer.getByLabel("Asset category").selectOption("real_estate");
  await issuer.getByLabel("Asset name").fill("Harbour Tower");
  await issuer.getByRole("button", { name: "Start application" }).click();
  await issuer.waitForURL(/\/rwa\/applications\/RWA-\d{4}-[A-Z2-7]{6}$/);
  const ref = issuer.url().split("/").pop();
  rep.check("application created with unique reference", /^RWA-\d{4}-[A-Z2-7]{6}$/.test(ref));
  rep.check("issuer address prefilled from linked wallet", (await issuer.getByLabel(/Issuing & distribution Stellar address/).inputValue()) === issuerWallet);

  await issuer.getByRole("button", { name: "Submit application" }).click();
  await issuer.getByText("Complete the application before submitting.").waitFor();
  rep.check("incomplete submission lists problems", await issuer.getByText("Upload: Proof of ownership.").isVisible());

  const fill = async (label, value) => issuer.getByLabel(label, { exact: false }).first().fill(value);
  await fill("Description", "Grade-A office building with 12 floors.");
  await fill("Country", "Exampleland");
  await fill("Jurisdiction", "Exampleland Securities Act");
  await fill("Legal issuer name", "Harbour Tower SPV Ltd");
  await fill("Issuer registration", "Companies Register 12345");
  await fill("Custodian", "Example Trust Co");
  await fill("Independent valuation", "25000000");
  await fill("Valuation currency", "USD");
  await fill("Valuation date", "2026-09-30");
  await fill("Legal ownership structure", "SPV owns 100% of the freehold");
  await fill("Redemption conditions", "Annual redemption window at NAV");
  await fill("Investor eligibility", "Professional investors only");
  await fill("Transfer restrictions", "Issuer-authorised wallets only");
  await issuer.getByRole("button", { name: "Save", exact: true }).click();
  await issuer.getByText("Saved.").waitFor();

  for (const [kind, label] of [["ownership", "Proof of ownership"], ["valuation", "Independent valuation report"], ["offering", "Offering document"], ["registration", "Issuer registration"]]) {
    await issuer.getByLabel("Document type").selectOption(kind);
    await issuer.getByLabel("Choose document").setInputFiles(PDF(`${kind}.pdf`));
    await issuer.getByRole("button", { name: "Upload" }).click();
    await issuer.locator(".nx-rwa-docs li", { hasText: label }).first().waitFor();
  }
  await issuer.getByLabel("Document type").selectOption("other");
  await issuer.getByLabel("Choose document").setInputFiles({ name: "evil.pdf", mimeType: "application/pdf", buffer: Buffer.from("<script>alert(1)</script>") });
  await issuer.getByRole("button", { name: "Upload" }).click();
  await issuer.getByText("Upload a PDF, PNG or JPEG file.").waitFor();
  rep.check("upload with fake PDF content refused", true);
  const enc = await sql`select ciphertext from rwa_documents limit 1`;
  rep.check("documents encrypted at rest", !Buffer.from(enc[0].ciphertext).includes(Buffer.from("%PDF")));
  const dl = await issuer.request.get(`${BASE}/api/rwa/documents/${(await sql`select id from rwa_documents where kind = 'ownership'`)[0].id}`);
  rep.check("owner can download own document", dl.status() === 200 && (await dl.text()).startsWith("%PDF"));

  await issuer.getByRole("button", { name: "Submit application" }).click();
  await issuer.locator(".nx-page-heading").getByText("Submitted", { exact: true }).waitFor();
  rep.check("application submitted; form locked", !(await issuer.getByRole("button", { name: "Save", exact: true }).count()));

  /* ───────── 4. Stranger can't see it ───────── */
  const stranger = await browser.newPage();
  const sres = await stranger.request.get(`${BASE}/api/rwa/applications/${ref}`);
  rep.check("anonymous can't read application", sres.status() === 401);

  /* ───────── 5. Admin review ───────── */
  await admin.getByRole("link", { name: "Applications" }).click();
  await admin.getByRole("link", { name: new RegExp(ref) }).click();
  await admin.getByRole("heading", { name: "Harbour Tower" }).waitFor();
  await admin.getByRole("button", { name: "Start review" }).click();
  await admin.locator(".nx-admin-heading").getByText("Under review", { exact: true }).first().waitFor();
  await admin.getByRole("button", { name: "Request information" }).click();
  await admin.getByLabel("What does the applicant need to provide?").fill("Please upload the insurance certificate.");
  await admin.getByRole("button", { name: "Confirm: Request information" }).click();
  await admin.locator(".nx-admin-heading").getByText("Additional information requested", { exact: true }).first().waitFor();
  await issuer.reload();
  await issuer.locator(".nx-rwa-notice").getByText("Please upload the insurance certificate.").waitFor();
  rep.check("applicant sees information request", true);
  await issuer.getByLabel("Document type").selectOption("insurance");
  await issuer.getByLabel("Choose document").setInputFiles(PDF("insurance.pdf"));
  await issuer.getByRole("button", { name: "Upload" }).click();
  await issuer.locator(".nx-rwa-docs li", { hasText: "Insurance certificate" }).waitFor();
  await issuer.getByRole("button", { name: "Submit application" }).click();
  await issuer.locator(".nx-page-heading").getByText("Submitted", { exact: true }).waitFor();

  await admin.reload();
  await admin.getByRole("button", { name: "Start review" }).click();
  await admin.locator(".nx-admin-heading").getByText("Under review", { exact: true }).first().waitFor();
  const docOpt = async kind => (await admin.locator("select").filter({ hasText: "— none —" }).locator("option", { hasText: kind }).first().getAttribute("value"));
  for (const [subject, kind] of [["issuer", "Issuer registration"], ["ownership", "Proof of ownership"], ["valuation", "Independent valuation report"]]) {
    await admin.getByLabel("Subject").selectOption(subject);
    await admin.getByLabel("Evidence status").selectOption("verified");
    await admin.getByLabel(/Evidence document/).selectOption(await docOpt(kind));
    await admin.getByLabel("What was checked and the outcome").fill(`Verified ${subject} against original.`);
    await admin.getByRole("button", { name: "Record finding" }).click();
    await admin.locator(".nx-admin-feed li", { hasText: `Verified ${subject} against original.` }).waitFor();
  }
  const ownershipDocId = await docOpt("Proof of ownership");
  await admin.getByRole("tab", { name: "Internal note" }).click();
  await admin.getByLabel(/Note \(internal/).fill("Internal: call custodian Monday");
  await admin.getByRole("button", { name: "Add note" }).click();
  await admin.locator(".nx-admin-feed li", { hasText: "call custodian Monday" }).waitFor();
  const dlStatus = await admin.evaluate(u => fetch(u).then(r => r.status), `/api/admin/documents/${ownershipDocId}`);
  rep.check("admin can download documents", dlStatus === 200);
  await admin.getByRole("button", { name: "Approve", exact: true }).click();
  await admin.getByLabel("Reason for approval (recorded)").fill("Evidence verified; meets criteria.");
  await admin.getByRole("button", { name: "Confirm: Approve" }).click();
  await admin.locator(".nx-admin-heading").getByText("Approved", { exact: true }).first().waitFor();
  rep.check("approved with recorded reason", (await sql`select status from rwa_applications where reference = ${ref}`)[0].status === "approved");
  await issuer.reload();
  rep.check("applicant never sees internal notes", !(await issuer.content()).includes("call custodian"));

  /* ───────── 6. Token configuration → final authorization ───────── */
  await issuer.getByLabel("Token code").fill("HTWR");
  await issuer.getByLabel("Total supply").fill("1000000");
  await issuer.getByLabel("Price per token").fill("25");
  await issuer.getByLabel("Minimum investment (tokens)").fill("100");
  await issuer.getByLabel("Rights represented by each token").fill("Pro-rata economic interest in the SPV");
  await issuer.locator("textarea").nth(1).fill("Tokens represent SPV participation notes");
  await issuer.getByLabel("Distribution rules").fill("Quarterly net rental income, pro rata");
  await issuer.getByLabel("Redemption terms").fill("Annual window at NAV less 2%");
  await issuer.getByRole("button", { name: "Save configuration" }).click();
  await issuer.getByText("Configuration saved.").waitFor();
  await issuer.getByRole("button", { name: "Submit for authorization" }).click();
  await issuer.getByText(/Submitted\. NEXORA performs a separate final authorization/).waitFor();
  rep.check("no issue button before authorization", !(await issuer.getByRole("button", { name: /Issue HTWR/ }).count()));

  await admin.reload();
  await admin.getByLabel(/Counsel \/ regulator reference/).fill("Counsel opinion 2026/77");
  await admin.getByLabel(/matches the offering documents/).check();
  await admin.getByLabel(/authorised to tokenize/).check();
  await admin.getByLabel(/I authorise the issuer to issue/).check();
  await admin.getByRole("button", { name: "Authorise issuance" }).click();
  await admin.getByText("Authorization requirements aren't met.").waitFor();
  const missingText = await admin.locator(".nx-rwa-notice-error").innerText();
  rep.check("typed counsel reference alone is refused as legal clearance", /regulatory clearance document on file/.test(missingText) && /document selected/.test(missingText));

  // Issuer uploads the legal opinion after approval (the only document type allowed now).
  await issuer.reload();
  await issuer.getByLabel("Document type").waitFor();
  const kinds = await issuer.getByLabel("Document type").locator("option").allInnerTexts();
  rep.check("after approval only the legal clearance document can be added", kinds.length === 1 && /Legal opinion/.test(kinds[0]), kinds.join(","));
  await issuer.getByLabel("Document type").selectOption("legal_opinion");
  await issuer.getByLabel("Choose document").setInputFiles(PDF("counsel-opinion.pdf"));
  await issuer.getByRole("button", { name: "Upload" }).click();
  await issuer.locator(".nx-rwa-docs li", { hasText: "counsel-opinion.pdf" }).waitFor();

  // Reviewer verifies it, then selects it as the clearance evidence.
  await admin.reload();
  await admin.getByLabel("Subject").selectOption("legal_clearance");
  await admin.getByLabel("Evidence status").selectOption("verified");
  await admin.getByLabel(/Evidence document/).selectOption(await docOpt("counsel-opinion.pdf"));
  await admin.getByLabel("What was checked and the outcome").fill("Verified legal opinion with issuing counsel.");
  await admin.getByRole("button", { name: "Record finding" }).click();
  await admin.locator(".nx-admin-feed li", { hasText: "Verified legal opinion with issuing counsel." }).waitFor();
  await admin.reload();
  const legalSelect = admin.getByLabel(/Legal clearance document/);
  await legalSelect.selectOption({ index: 1 });
  rep.check("verified legal clearance document offered for selection", /counsel-opinion\.pdf/.test(await legalSelect.locator("option:checked").innerText()));
  await admin.getByLabel(/Counsel \/ regulator reference/).fill("Counsel opinion 2026/77");
  await admin.getByLabel(/matches the offering documents/).check();
  await admin.getByLabel(/authorised to tokenize/).check();
  await admin.getByLabel(/I authorise the issuer to issue/).check();
  await admin.getByRole("button", { name: "Authorise issuance" }).click();
  await admin.getByText("Recorded.").waitFor();
  const clearance = (await sql`select legal_clearance from rwa_token_configs`)[0].legal_clearance;
  rep.check("authorization records the clearance document and its SHA-256", clearance?.document?.filename === "counsel-opinion.pdf" && /^[0-9a-f]{64}$/.test(clearance?.document?.sha256 ?? ""));
  rep.check("issuance authorised (audited)", (await sql`select count(*)::int n from admin_audit_log where action = 'rwa.tokenization.authorized'`)[0].n === 1);

  /* ───────── 7. Issuance from the issuer's own wallet (approval sheet) ───────── */
  await issuer.reload();
  await issuer.getByRole("button", { name: /Issue HTWR on Stellar/ }).click();
  const sheetText = await approveSheet(issuer);
  rep.check("approval sheet shows issuer creation + controls", /Create account/.test(sheetText) && /authorization required, revocable, clawback/.test(sheetText) && /Authorize holder/.test(sheetText));
  rep.check("issuer is NOT locked (no fixed-supply lock)", !/Lock issuer/.test(sheetText));
  await issuer.getByText("HTWR is live").waitFor();
  const issueTx = chain.submitted.at(-1);
  const tokenIssuer = issueTx.operations[0].destination;
  rep.check("issuance tx: flags auth required+revocable+clawback", issueTx.operations[1].setFlags === 11);
  await issuer.getByLabel(/I have saved the issuer secret key/).check();
  await issuer.getByRole("button", { name: "Done" }).click();
  const issueHash = Buffer.from(issueTx.hash()).toString("hex");
  const recorded = (await sql`select status from rwa_token_configs`)[0].status;
  if (recorded !== "issued") {
    await issuer.getByLabel(/Already issued\?/).fill(issueHash);
    await issuer.getByRole("button", { name: "Verify & record" }).click();
    await issuer.getByText("Issuance verified on Stellar and recorded.").waitFor();
  }
  rep.check("server verified the signed issuance against (mock) Horizon", (await sql`select status, issuer_address from rwa_token_configs`)[0].issuer_address === tokenIssuer);

  /* ───────── 8. Listing and subscriptions ───────── */
  await admin.reload();
  const pubBox = admin.locator(".nx-rwa-docs li", { hasText: "Offering document" }).getByLabel("Publish with offering");
  await pubBox.click();
  await admin.waitForFunction(el => el.checked, await pubBox.elementHandle());
  await admin.getByRole("button", { name: "List offering on the explorer" }).click();
  await admin.getByRole("button", { name: "Unlist offering" }).waitFor();
  await admin.getByRole("link", { name: "Settings" }).click();
  await admin.getByLabel(/Allow investors to request subscriptions/).check();
  await admin.getByRole("button", { name: "Save settings" }).click();
  await admin.getByText("Settings saved.").waitFor();

  const invCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const investor = await invCtx.newPage();
  await mockStellar(investor, chain);
  await investor.goto(`${BASE}/rwa`, { waitUntil: "networkidle" });
  await investor.getByRole("link", { name: /Harbour Tower/ }).click();
  await investor.waitForURL(`**/rwa/${ref}`);
  await investor.getByRole("heading", { level: 1, name: "Harbour Tower" }).waitFor();
  await investor.getByText("Offering documents").waitFor();
  const offerText = await investor.locator("body").innerText();
  rep.check("offering shows verified vs declared evidence", /Verified by NEXORA/i.test(offerText) && /Issuer declaration/i.test(offerText), offerText.slice(0, 600).replace(/\s+/g, " "));
  rep.check("offering shows risk disclosure, no guarantees", /not guaranteed/i.test(offerText) && !/guaranteed return/i.test(offerText));
  rep.check("only the published document is listed", (await investor.locator(".nx-rwa-docs li").count()) === 1, String(await investor.locator(".nx-rwa-docs li").count()));
  const noScroll = await investor.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  rep.check("offering page has no horizontal scroll on mobile", noScroll);
  await investor.getByRole("tab", { name: "Create account" }).click();
  await investor.getByLabel("Email").fill("investor@example.com");
  await investor.getByLabel(/^Password/).fill(PW);
  await investor.getByLabel("Confirm password").fill(PW);
  await investor.getByRole("button", { name: "Create account" }).click();
  await investor.getByText(/Check your email/).waitFor();
  await investor.goto(`${BASE}/account/verify?token=${await lastToken("investor@example.com")}`);
  await investor.getByLabel("Password").fill(PW);
  await investor.getByRole("button", { name: "Confirm email" }).click();
  await investor.getByRole("heading", { name: "Your account" }).waitFor();
  const { address: investorWallet } = await createWallet(investor);
  chain.accounts[investorWallet] = { seq: 700, balances: [{ asset_type: "native", balance: "20.0000000", selling_liabilities: "0" }] };
  await investor.goto(`${BASE}/rwa/${ref}`, { waitUntil: "networkidle" });
  await investor.getByLabel(/Tokens \(minimum/).fill("500");
  rep.check("subscribe disabled until attestations", await investor.getByRole("button", { name: "Request subscription" }).isDisabled());
  await investor.getByLabel(/I meet the investor eligibility/).check();
  await investor.getByLabel(/I have read the risk disclosure/).check();
  await investor.getByRole("button", { name: "Request subscription" }).click();
  await maybeUnlock(investor);
  await investor.getByText(/Request sent to the issuer/).waitFor();
  rep.check("subscription requested", (await sql`select status from rwa_subscriptions`)[0].status === "requested");

  // Issuer accepts.
  await issuer.reload();
  await issuer.getByRole("button", { name: "Accept" }).click();
  await issuer.getByRole("button", { name: "Authorise trustline" }).waitFor();

  // Investor adds the trustline from their wallet.
  await investor.reload();
  await investor.getByRole("button", { name: "Add trustline" }).first().click();
  await approveSheet(investor);
  await investor.getByText(/Trustline added/).waitFor();
  const trustTx = chain.submitted.at(-1);
  rep.check("investor trustline tx signed by investor", trustTx.source === investorWallet && trustTx.operations[0].type === "changeTrust" && trustTx.operations[0].line.code === "HTWR");
  chain.accounts[investorWallet].balances.push({ asset_type: "credit_alphanum4", asset_code: "HTWR", asset_issuer: tokenIssuer, balance: "0.0000000", limit: "922337203685.4775807", is_authorized: false });
  chain.accounts[issuerWallet].balances.push({ asset_type: "credit_alphanum4", asset_code: "HTWR", asset_issuer: tokenIssuer, balance: "1000000.0000000", limit: "922337203685.4775807", is_authorized: true, selling_liabilities: "0" });

  // Issuer authorises the trustline (wallet + locally stored issuer key co-sign).
  await issuer.getByRole("button", { name: "Authorise trustline" }).click();
  await approveSheet(issuer);
  await issuer.getByText("Trustline authorised and verified.").waitFor();
  const authTx = chain.submitted.at(-1);
  const signedBy = pub => authTx.signatures.some(sg => Keypair.fromPublicKey(pub).verify(authTx.hash(), Buffer.from(sg.signature.value ?? sg.signature())));
  rep.check("authorisation co-signed by wallet and issuer key", signedBy(issuerWallet) && signedBy(tokenIssuer) && authTx.operations[0].type === "setTrustLineFlags");

  await issuer.getByRole("button", { name: "Deliver tokens" }).click();
  await approveSheet(issuer);
  await issuer.getByText("Delivery verified on Stellar.").waitFor();
  const payTx = chain.submitted.at(-1);
  rep.check("delivery is a 500 HTWR payment to the investor", payTx.operations[0].type === "payment" && payTx.operations[0].amount === "500.0000000" && payTx.operations[0].destination === investorWallet);
  rep.check("subscription delivered", (await sql`select status from rwa_subscriptions`)[0].status === "delivered");

  /* ───────── 9. Lifecycle ───────── */
  await issuer.getByLabel("Report type").selectOption("valuation_update");
  await issuer.getByLabel("Title").fill("Q3 independent valuation");
  await issuer.getByLabel("Choose report file").setInputFiles(PDF("q3.pdf"));
  await issuer.getByRole("button", { name: "File report" }).click();
  await issuer.getByText("Report filed.").waitFor();
  await investor.reload();
  await investor.getByLabel("Tokens to redeem").fill("100");
  await investor.getByRole("button", { name: "Send request" }).click();
  await investor.getByText("Redemption request sent to the issuer.").waitFor();
  rep.check("public history shows the issuer report", await investor.getByText("Q3 independent valuation").isVisible());
  await issuer.reload();
  await issuer.getByRole("button", { name: "Acknowledge" }).click();
  await issuer.locator(".nx-admin-feed li", { hasText: "Redemption request" }).getByText("Acknowledged").waitFor();
  rep.check("issuer acknowledges redemption request", true);

  /* ───────── 10. Suspension + audit ───────── */
  await admin.goto(`${ADMIN}/admin/applications/${ref}`);
  await admin.getByRole("button", { name: "Suspend" }).click();
  await admin.getByLabel(/Reason for suspension/).fill("Custodian confirmation lapsed");
  await admin.getByRole("button", { name: "Confirm: Suspend" }).click();
  await admin.locator(".nx-admin-heading").getByText("Suspended", { exact: true }).first().waitFor();
  const gone = await investor.request.get(`${BASE}/api/rwa/offerings/${ref}`);
  rep.check("suspended offering disappears from the explorer", gone.status() === 404);
  await admin.getByRole("link", { name: "Audit log" }).click();
  await admin.getByRole("heading", { name: "Audit log" }).waitFor();
  await admin.locator(".nx-admin-table code", { hasText: "rwa.suspend" }).first().waitFor();
  const log = await admin.locator(".nx-admin-table").innerText();
  rep.check("audit log shows decisions with actor", ["rwa.approve", "rwa.suspend", "rwa.tokenization.authorized", "admin.bootstrap.completed", "admin.login.rejected"].every(a => log.includes(a)) && log.includes(FOUNDER), ["rwa.approve", "rwa.suspend", "rwa.tokenization.authorized", "admin.bootstrap.completed", "admin.login.rejected"].filter(a => !log.includes(a)).join(","));
  await admin.getByRole("link", { name: "Users & issuers" }).click();
  await admin.getByRole("heading", { name: "Users & issuers" }).waitFor();
  await admin.getByText("issuer@example.com").waitFor();
  rep.check("users page lists issuer and investor", await admin.getByText("investor@example.com").isVisible());
  await admin.getByRole("link", { name: "Assets & tokens" }).click();
  await admin.getByRole("heading", { name: "Assets & tokens" }).waitFor();
  await admin.getByRole("button", { name: "Check on-chain state" }).click();
  await admin.getByText("Issuer account exists").waitFor();
  rep.check("on-chain monitoring reads (mock) Horizon", true);

  // Admin portal at phone width, light theme.
  await admin.setViewportSize({ width: 390, height: 844 });
  await admin.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await admin.goto(`${ADMIN}/admin/applications/${ref}`);
  await admin.getByRole("heading", { name: "Harbour Tower" }).waitFor();
  rep.check("admin detail has no horizontal scroll on mobile", await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await admin.evaluate(() => { const w = window.innerWidth; return [document.documentElement.scrollWidth, ...[...document.querySelectorAll("body *")].filter(e => e.getBoundingClientRect().right > w + 1 && !e.closest(".nx-admin-side nav")).slice(0, 6).map(e => e.tagName + "." + e.className + ":" + Math.round(e.getBoundingClientRect().right))].join(" | "); }));

  // Admin session cookie is not sent to the public host and gives no access there.
  const crossHost = await admin.request.get(`${BASE}/api/admin/overview`);
  rep.check("admin session useless on public host", crossHost.status() === 404);
} catch (e) {
  rep.check("suite completed without error", false, String(e?.message ?? e).split("\n")[0]);
  if (process.env.E2E_DEBUG_DIR) for (const [i, p] of browser.contexts().flatMap(c => c.pages()).entries()) {
    await p.screenshot({ path: `${process.env.E2E_DEBUG_DIR}/fail-${i}.png`, fullPage: true }).catch(() => {});
    console.log(`page ${i} ${p.url()} notices:`, await p.locator(".nx-rwa-notice").allInnerTexts().catch(() => []));
  }
} finally {
  await browser.close();
  await sql.end();
  rep.print();
}
