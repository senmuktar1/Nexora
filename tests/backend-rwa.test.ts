import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { Keypair } from "@stellar/stellar-sdk";
import { call, freshDatabase, newJar, TEST_DB, type Jar } from "./helpers/db";

vi.mock("server-only", () => ({}));

/**
 * RWA workflow end to end at the API level against real PostgreSQL: applications,
 * encrypted documents, access control, review decisions, findings, final authorization,
 * on-chain issuance verification (Horizon MOCKED), offerings, subscriptions, lifecycle.
 */
const ADMIN = "admin.nexora.test";
const PUBLIC = "nexora.test";
const FOUNDER = "founder@example.com";
const PW = "correct horse battery staple";
const ISSUER_WALLET = Keypair.random().publicKey();
const INVESTOR_WALLET = Keypair.random().publicKey();
const TOKEN_ISSUER = Keypair.random().publicKey();
const PDF = Buffer.from("%PDF-1.7\nNEXORA-SECRET-DOCUMENT-CONTENT\n%%EOF");

type H = Parameters<typeof call>[0];

describe.skipIf(!TEST_DB)("RWA workflow (PostgreSQL)", () => {
  let sql: postgres.Sql;
  let R: Record<string, Record<string, H>>;
  let totp: typeof import("@/lib/server/auth/totp");
  const admin = newJar(), issuer = newJar(), investor = newJar(), stranger = newJar();
  let ref = "";
  const docs: Record<string, string> = {};
  let horizon: Record<string, unknown> = {};

  const lastToken = async (to: string) => {
    const rows = await sql`select body from email_outbox where to_email = ${to} order by id desc limit 1`;
    return /token=([A-Za-z0-9_-]+)/.exec((rows[0]?.body as string) ?? "")?.[1] ?? "";
  };
  async function publicUser(email: string, jar: Jar) {
    await call(R.register.POST, { host: PUBLIC, path: "/api/account/register", body: { email, password: PW } });
    const r = await call(R.accVerify.POST, { host: PUBLIC, path: "/api/account/verify", body: { token: await lastToken(email), password: PW }, jar });
    expect(r.status).toBe(200);
  }
  const upload = (kind: string, bytes: Buffer, name = `${kind}.pdf`, jar = issuer) => {
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", new File([new Uint8Array(bytes)], name, { type: "application/pdf" }));
    return call(R.docs.POST, { host: PUBLIC, path: `/api/rwa/applications/${ref}/documents`, form, jar }, { ref });
  };
  const decide = (action: string, reason = "") => call(R.status.POST, { host: ADMIN, path: `/api/admin/applications/${ref}/status`, body: { action, reason }, jar: admin }, { ref });
  const finding = (subject: string, evidenceStatus: string, documentId?: string) =>
    call(R.findings.POST, { host: ADMIN, path: `/api/admin/applications/${ref}/findings`, body: { kind: "finding", subject, evidenceStatus, documentId, body: `Checked ${subject}` }, jar: admin }, { ref });

  beforeAll(async () => {
    const DB = await freshDatabase("rwa");
    Object.assign(process.env, {
      DATABASE_URL: DB, ADMIN_HOST: ADMIN, NEXORA_ADMIN_EMAIL: FOUNDER, EMAIL_TEST_OUTBOX: "true",
      DATA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64")
    });
    sql = postgres(DB, { max: 1, onnotice: () => {} });
    totp = await import("@/lib/server/auth/totp");
    const imp = async (p: string) => (await import(/* @vite-ignore */ p)) as Record<string, H>;
    R = {
      bootstrap: await imp("@/app/api/admin/auth/bootstrap/route"), verify: await imp("@/app/api/admin/auth/verify/route"),
      mfaSetup: await imp("@/app/api/admin/auth/mfa/setup/route"), mfaEnable: await imp("@/app/api/admin/auth/mfa/enable/route"),
      register: await imp("@/app/api/account/register/route"), accVerify: await imp("@/app/api/account/verify/route"), me: await imp("@/app/api/account/me/route"),
      apps: await imp("@/app/api/rwa/applications/route"), app: await imp("@/app/api/rwa/applications/[ref]/route"),
      submit: await imp("@/app/api/rwa/applications/[ref]/submit/route"), docs: await imp("@/app/api/rwa/applications/[ref]/documents/route"),
      doc: await imp("@/app/api/rwa/documents/[id]/route"), cfg: await imp("@/app/api/rwa/applications/[ref]/token-config/route"),
      issuance: await imp("@/app/api/rwa/applications/[ref]/issuance/route"), events: await imp("@/app/api/rwa/applications/[ref]/events/route"),
      issuerSub: await imp("@/app/api/rwa/applications/[ref]/subscriptions/[id]/route"),
      offerings: await imp("@/app/api/rwa/offerings/route"), offering: await imp("@/app/api/rwa/offerings/[ref]/route"),
      subscribe: await imp("@/app/api/rwa/offerings/[ref]/subscriptions/route"), redeem: await imp("@/app/api/rwa/offerings/[ref]/redemptions/route"),
      adminApps: await imp("@/app/api/admin/applications/route"), adminApp: await imp("@/app/api/admin/applications/[ref]/route"),
      status: await imp("@/app/api/admin/applications/[ref]/status/route"), findings: await imp("@/app/api/admin/applications/[ref]/findings/route"),
      authorize: await imp("@/app/api/admin/applications/[ref]/token-config/route"), publish: await imp("@/app/api/admin/applications/[ref]/publish/route"),
      adminDoc: await imp("@/app/api/admin/documents/[id]/route"), docVis: await imp("@/app/api/admin/applications/[ref]/documents/[id]/route"),
      settings: await imp("@/app/api/admin/settings/route"), audit: await imp("@/app/api/admin/audit/route"),
      adminEvents: await imp("@/app/api/admin/applications/[ref]/events/route")
    };
    // Founder admin (bootstrap → verify → MFA).
    await call(R.bootstrap.POST, { host: ADMIN, path: "/x", body: { email: FOUNDER, password: PW } });
    await call(R.verify.POST, { host: ADMIN, path: "/x", body: { token: await lastToken(FOUNDER), password: PW }, jar: admin });
    const s = await call(R.mfaSetup.POST, { host: ADMIN, path: "/x", body: {}, jar: admin });
    await call(R.mfaEnable.POST, { host: ADMIN, path: "/x", body: { code: totp.totpAt(s.json.secret as string, totp.currentStep()) }, jar: admin });
    await publicUser("issuer@example.com", issuer);
    await publicUser("investor@example.com", investor);
    await publicUser("stranger@example.com", stranger);

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      const key = Object.keys(horizon).find(k => url.endsWith(k));
      if (!key) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify(horizon[key]), { status: 200, headers: { "content-type": "application/json" } });
    }));
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await sql?.end();
    const { __closeDbForTests } = await import("@/lib/server/db");
    await __closeDbForTests();
  });

  it("requires a signed-in, verified account to start an application", async () => {
    expect((await call(R.apps.POST, { host: PUBLIC, path: "/api/rwa/applications", body: { category: "real_estate", asset_name: "Tower" } })).status).toBe(401);
    expect((await call(R.apps.POST, { host: ADMIN, path: "/api/rwa/applications", body: { category: "real_estate", asset_name: "Tower" }, jar: issuer })).status).toBe(404);
  });

  it("creates a draft with a unique reference and validates fields", async () => {
    expect((await call(R.apps.POST, { host: PUBLIC, path: "/x", body: { category: "spaceships", asset_name: "X" }, jar: issuer })).status).toBe(400);
    const r = await call(R.apps.POST, { host: PUBLIC, path: "/api/rwa/applications", body: { category: "real_estate", asset_name: "Harbour Tower" }, jar: issuer });
    expect(r.status).toBe(201);
    ref = r.json.reference as string;
    expect(ref).toMatch(/^RWA-\d{4}-[A-Z2-7]{6}$/);
    const bad = await call(R.app.PATCH, { method: "PATCH", host: PUBLIC, path: "/x", body: { valuation_date: "2999-01-01" }, jar: issuer }, { ref });
    expect(bad.status).toBe(400);
    const ok = await call(R.app.PATCH, { method: "PATCH", host: PUBLIC, path: "/x", jar: issuer, body: {
      description: "Grade-A office building, 12 floors.", country: "Exampleland", jurisdiction: "Exampleland Securities Act",
      issuer_legal_name: "Harbour Tower SPV Ltd", issuer_registration: "Companies Register 12345", custodian: "Example Trust Co",
      legal_structure: "SPV owns 100% of the freehold", redemption_conditions: "Annual redemption window at NAV",
      investor_eligibility: "Professional investors only", transfer_restrictions: "Transfers only to issuer-approved wallets",
      valuation_amount: "25000000", valuation_currency: "usd", valuation_date: "2026-09-30", issuer_stellar_address: ISSUER_WALLET,
      status: "approved", owner_user_id: "00000000-0000-0000-0000-000000000000"
    } }, { ref });
    expect(ok.status).toBe(200);
    const row = (await sql`select status, valuation_currency from rwa_applications where reference = ${ref}`)[0];
    expect(row).toMatchObject({ status: "draft", valuation_currency: "USD" });
  });

  it("can't submit without the required documents", async () => {
    const r = await call(R.submit.POST, { host: PUBLIC, path: "/x", body: {}, jar: issuer }, { ref });
    expect(r.status).toBe(400);
    expect((r.json.problems as string[]).join(" ")).toContain("Proof of ownership");
  });

  it("accepts PDF/PNG/JPEG only (content-sniffed), max 4 MB, and stores them encrypted", async () => {
    expect((await upload("ownership", Buffer.from("<html><script>alert(1)</script>"), "evil.pdf")).status).toBe(415);
    expect((await upload("ownership", Buffer.concat([PDF, Buffer.alloc(4 * 1024 * 1024)]))).status).toBe(413);
    for (const k of ["ownership", "valuation", "offering", "registration"]) {
      const r = await upload(k, PDF, `../../${k} report.pdf`);
      expect(r.status).toBe(201);
      docs[k] = (r.json.document as { id: string }).id;
    }
    const stored = await sql`select filename, ciphertext from rwa_documents`;
    for (const d of stored) {
      expect(Buffer.from(d.ciphertext as Uint8Array).includes(Buffer.from("NEXORA-SECRET"))).toBe(false);
      expect(d.filename).not.toContain("/");
    }
  });

  it("documents and applications are private to their owner", async () => {
    const own = await call(R.doc.GET, { host: PUBLIC, path: "/x", jar: issuer }, { id: docs.ownership });
    expect(own.status).toBe(200);
    expect(own.text).toContain("NEXORA-SECRET-DOCUMENT-CONTENT");
    expect(own.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(own.headers.get("content-security-policy")).toContain("sandbox");
    expect((await call(R.doc.GET, { host: PUBLIC, path: "/x", jar: stranger }, { id: docs.ownership })).status).toBe(404);
    expect((await call(R.doc.GET, { host: PUBLIC, path: "/x" }, { id: docs.ownership })).status).toBe(404);
    expect((await call(R.app.GET, { host: PUBLIC, path: "/x", jar: stranger }, { ref })).status).toBe(404);
    // Admin can't see drafts; and admin document access requires an admin session on the admin host.
    expect((await call(R.adminApp.GET, { host: ADMIN, path: "/x", jar: admin }, { ref })).status).toBe(404);
    expect((await call(R.adminDoc.GET, { host: ADMIN, path: "/x", jar: issuer }, { id: docs.ownership })).status).toBe(401);
  });

  it("submits, and the applicant can no longer edit", async () => {
    expect((await call(R.submit.POST, { host: PUBLIC, path: "/x", body: {}, jar: issuer }, { ref })).status).toBe(200);
    expect((await call(R.app.PATCH, { method: "PATCH", host: PUBLIC, path: "/x", body: { description: "changed" }, jar: issuer }, { ref })).status).toBe(409);
    expect((await upload("other", PDF)).status).toBe(409);
  });

  it("token configuration stays locked before approval", async () => {
    expect((await call(R.cfg.PUT, { method: "PUT", host: PUBLIC, path: "/x", body: {}, jar: issuer }, { ref })).status).toBe(409);
  });

  it("admin review: start, request info, applicant responds, resubmits", async () => {
    const list = await call(R.adminApps.GET, { host: ADMIN, path: "/api/admin/applications?status=submitted", jar: admin });
    expect((list.json.applications as { reference: string }[]).map(a => a.reference)).toContain(ref);
    expect((await decide("approve", "too early")).status).toBe(409);
    expect((await decide("start_review")).status).toBe(200);
    expect((await decide("request_info", "")).status).toBe(400);
    expect((await decide("request_info", "Provide the insurance certificate.")).status).toBe(200);
    const view = await call(R.app.GET, { host: PUBLIC, path: "/x", jar: issuer }, { ref });
    expect((view.json.application as { info_request: string }).info_request).toBe("Provide the insurance certificate.");
    expect(view.json.findings).toBeUndefined();
    expect((await upload("insurance", PDF)).status).toBe(201);
    expect((await call(R.submit.POST, { host: PUBLIC, path: "/x", body: {}, jar: issuer }, { ref })).status).toBe(200);
    expect((await decide("start_review")).status).toBe(200);
  });

  it("findings distinguish declarations from verified evidence; verified needs a cited document", async () => {
    expect((await finding("issuer", "verified")).status).toBe(400);
    expect((await finding("issuer", "verified", docs.registration)).status).toBe(201);
    expect((await finding("ownership", "verified", docs.ownership)).status).toBe(201);
    expect((await finding("valuation", "declared")).status).toBe(201);
    const note = await call(R.findings.POST, { host: ADMIN, path: "/x", body: { kind: "note", body: "Internal: call custodian Monday" }, jar: admin }, { ref });
    expect(note.status).toBe(201);
    const view = await call(R.app.GET, { host: PUBLIC, path: "/x", jar: issuer }, { ref });
    expect(view.text).not.toContain("call custodian");
    const dl = await call(R.adminDoc.GET, { host: ADMIN, path: "/x", jar: admin }, { id: docs.valuation });
    expect(dl.status).toBe(200);
  });

  it("approval needs a recorded reason and is fully audited", async () => {
    expect((await decide("approve", "")).status).toBe(400);
    expect((await decide("approve", "Evidence reviewed; meets listing criteria.")).status).toBe(200);
    const hist = await sql`select from_status, to_status, reason, actor_user_id from rwa_status_history h join rwa_applications a on a.id = h.application_id where a.reference = ${ref} order by h.id`;
    expect(hist.map(x => x.to_status)).toEqual(["draft", "submitted", "under_review", "info_requested", "submitted", "under_review", "approved"]);
    const log = await sql`select actor_email, action, previous_status, new_status, reason from admin_audit_log where target_id = ${ref} and action = 'rwa.approve'`;
    expect(log[0]).toMatchObject({ actor_email: FOUNDER, previous_status: "under_review", new_status: "approved", reason: "Evidence reviewed; meets listing criteria." });
  });

  const config = () => ({
    token_code: "HTWR", total_supply: "1000000", price_amount: "25", price_currency: "USD", min_investment: "100",
    token_rights: "Pro-rata economic interest in the SPV", ownership_structure: "Tokens represent SPV participation notes",
    distribution_rules: "Quarterly net rental income, pro rata", investor_eligibility: "Professional investors only",
    transfer_restrictions: "Issuer-authorised trustlines only (AUTH_REQUIRED)", redemption_terms: "Annual window at NAV less 2%",
    distributor_address: ISSUER_WALLET, clawback_enabled: true
  });

  it("final tokenization authorization is separate and checks every requirement", async () => {
    expect((await call(R.cfg.PUT, { method: "PUT", host: PUBLIC, path: "/x", body: { ...config(), total_supply: "-5" }, jar: issuer }, { ref })).status).toBe(400);
    expect((await call(R.cfg.PUT, { method: "PUT", host: PUBLIC, path: "/x", body: config(), jar: issuer }, { ref })).status).toBe(200);
    // Not submitted yet → not authorisable.
    const early = await call(R.authorize.POST, { host: ADMIN, path: "/x", jar: admin, body: { action: "authorize", legalClearanceRef: "Opinion 2026/77", configMatchesOffering: true, issuerAuthorized: true, authorizeDeployment: true } }, { ref });
    expect(early.status).toBe(400);
    expect((await call(R.cfg.POST, { host: PUBLIC, path: "/x", body: { action: "submit" }, jar: issuer }, { ref })).status).toBe(200);
    expect((await call(R.cfg.PUT, { method: "PUT", host: PUBLIC, path: "/x", body: config(), jar: issuer }, { ref })).status).toBe(409);
    // Valuation was only "declared" → missing verified evidence.
    const missing = await call(R.authorize.POST, { host: ADMIN, path: "/x", jar: admin, body: { action: "authorize", legalClearanceRef: "Opinion 2026/77", configMatchesOffering: true, issuerAuthorized: true, authorizeDeployment: true } }, { ref });
    expect(missing.status).toBe(400);
    expect((missing.json.missing as string[]).join()).toContain("Verified findings");
    expect((await finding("valuation", "verified", docs.valuation)).status).toBe(201);
    const noDeploy = await call(R.authorize.POST, { host: ADMIN, path: "/x", jar: admin, body: { action: "authorize", legalClearanceRef: "Opinion 2026/77", configMatchesOffering: true, issuerAuthorized: true } }, { ref });
    expect((noDeploy.json.missing as string[]).join()).toContain("Mainnet issuance explicitly authorised");
    // A typed counsel reference alone is never accepted as legal clearance.
    const refOnly = await call(R.authorize.POST, { host: ADMIN, path: "/x", jar: admin, body: { action: "authorize", legalClearanceRef: "Opinion 2026/77", configMatchesOffering: true, issuerAuthorized: true, authorizeDeployment: true } }, { ref });
    expect(refOnly.status).toBe(400);
    expect((refOnly.json.missing as string[]).join()).toMatch(/Legal opinion \/ regulatory clearance document on file/);
    // A "legal clearance" finding can't be verified against an unrelated document.
    expect((await finding("legal_clearance", "verified", docs.offering)).status).toBe(400);
    // After approval the issuer may add only the legal opinion / regulatory clearance.
    expect((await upload("other", PDF)).status).toBe(409);
    const legal = await upload("legal_opinion", PDF, "counsel-opinion.pdf");
    expect(legal.status).toBe(201);
    docs.legal = (legal.json.document as { id: string }).id;
    // Uploaded but not yet verified by a reviewer → still missing.
    const unverified = await call(R.authorize.POST, { host: ADMIN, path: "/x", jar: admin, body: { action: "authorize", legalClearanceDocumentId: docs.legal, legalClearanceRef: "Opinion 2026/77", configMatchesOffering: true, issuerAuthorized: true, authorizeDeployment: true } }, { ref });
    expect((unverified.json.missing as string[]).join()).toMatch(/on file and recorded as verified/);
    expect((await finding("legal_clearance", "declared", docs.legal)).status).toBe(201);
    const declaredOnly = await call(R.authorize.POST, { host: ADMIN, path: "/x", jar: admin, body: { action: "authorize", legalClearanceDocumentId: docs.legal, legalClearanceRef: "Opinion 2026/77", configMatchesOffering: true, issuerAuthorized: true, authorizeDeployment: true } }, { ref });
    expect(declaredOnly.status).toBe(400);
    expect((await finding("legal_clearance", "verified", docs.legal)).status).toBe(201);
    // Verified document must be the one selected; a different document id doesn't count.
    const wrongDoc = await call(R.authorize.POST, { host: ADMIN, path: "/x", jar: admin, body: { action: "authorize", legalClearanceDocumentId: docs.offering, legalClearanceRef: "Opinion 2026/77", configMatchesOffering: true, issuerAuthorized: true, authorizeDeployment: true } }, { ref });
    expect((wrongDoc.json.missing as string[]).join()).toMatch(/document selected/);
    const noRef = await call(R.authorize.POST, { host: ADMIN, path: "/x", jar: admin, body: { action: "authorize", legalClearanceDocumentId: docs.legal, configMatchesOffering: true, issuerAuthorized: true, authorizeDeployment: true } }, { ref });
    expect((noRef.json.missing as string[]).join()).toMatch(/Counsel \/ regulator reference/);
    const ok = await call(R.authorize.POST, { host: ADMIN, path: "/x", jar: admin, body: { action: "authorize", legalClearanceDocumentId: docs.legal, legalClearanceRef: "Opinion 2026/77", configMatchesOffering: true, issuerAuthorized: true, authorizeDeployment: true } }, { ref });
    expect(ok.status).toBe(200);
    const stored = (await sql`select legal_clearance from rwa_token_configs`)[0].legal_clearance as { document: { id: string; sha256: string } };
    expect(stored.document.id).toBe(docs.legal);
    expect(stored.document.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Once authorised, the issuer can't add further documents.
    expect((await upload("legal_opinion", PDF)).status).toBe(409);
    expect((await sql`select count(*)::int n from admin_audit_log where action = 'rwa.tokenization.authorized'`)[0].n).toBe(1);
  });

  function issuanceTx(over: { flags?: number[]; lock?: boolean; amount?: string; source?: string; extraPayment?: boolean } = {}) {
    const hash = "a".repeat(64);
    horizon = {
      [`/transactions/${hash}`]: { successful: true, source_account: over.source ?? ISSUER_WALLET, operation_count: over.lock || over.extraPayment ? 6 : 5 },
      [`/transactions/${hash}/operations?limit=200`]: { _embedded: { records: [
        { type: "create_account", source_account: ISSUER_WALLET, funder: ISSUER_WALLET, account: TOKEN_ISSUER, starting_balance: "1.5000000" },
        { type: "set_options", source_account: TOKEN_ISSUER, set_flags: over.flags ?? [1, 2, 8] },
        { type: "change_trust", source_account: ISSUER_WALLET, trustor: ISSUER_WALLET, asset_code: "HTWR", asset_issuer: TOKEN_ISSUER },
        { type: "set_trust_line_flags", source_account: TOKEN_ISSUER, trustor: ISSUER_WALLET, asset_code: "HTWR", asset_issuer: TOKEN_ISSUER, set_flags: [1] },
        { type: "payment", source_account: TOKEN_ISSUER, from: TOKEN_ISSUER, to: ISSUER_WALLET, asset_code: "HTWR", asset_issuer: TOKEN_ISSUER, amount: over.amount ?? "1000000.0000000" },
        ...(over.lock ? [{ type: "set_options", source_account: TOKEN_ISSUER, master_key_weight: 0 }] : []),
        ...(over.extraPayment ? [{ type: "payment", source_account: TOKEN_ISSUER, from: TOKEN_ISSUER, to: INVESTOR_WALLET, asset_code: "HTWR", asset_issuer: TOKEN_ISSUER, amount: "10.0000000" }] : [])
      ] } },
      [`/accounts/${TOKEN_ISSUER}`]: { flags: { auth_required: true, auth_revocable: true, auth_clawback_enabled: true } }
    };
    return hash;
  }

  it("issuance is recorded only when the on-chain transaction matches the authorisation (Horizon mocked)", async () => {
    const post = (hash: string) => call(R.issuance.POST, { host: PUBLIC, path: "/x", body: { txHash: hash }, jar: issuer }, { ref });
    expect((await post(issuanceTx({ flags: [1] }))).status).toBe(400);
    expect((await post(issuanceTx({ lock: true }))).status).toBe(400);
    expect((await post(issuanceTx({ extraPayment: true }))).status).toBe(400);
    expect((await post(issuanceTx({ amount: "999999.0000000" }))).status).toBe(400);
    expect((await post(issuanceTx({ source: INVESTOR_WALLET }))).status).toBe(400);
    expect((await call(R.issuance.POST, { host: PUBLIC, path: "/x", body: { txHash: issuanceTx() }, jar: stranger }, { ref })).status).toBe(404);
    const ok = await post(issuanceTx());
    expect(ok.status).toBe(200);
    expect(ok.json.issuer).toBe(TOKEN_ISSUER);
    expect((await post(issuanceTx())).status).toBe(409);
  });

  it("offerings appear only after an admin lists them; private documents stay private", async () => {
    expect(((await call(R.offerings.GET, { host: PUBLIC, path: "/x" })).json.offerings as unknown[]).length).toBe(0);
    expect((await call(R.offering.GET, { host: PUBLIC, path: "/x" }, { ref })).status).toBe(404);
    expect((await call(R.publish.POST, { host: ADMIN, path: "/x", body: { published: true }, jar: admin }, { ref })).status).toBe(200);
    expect((await call(R.docVis.PATCH, { method: "PATCH", host: ADMIN, path: "/x", body: { public: true }, jar: admin }, { ref, id: docs.offering })).status).toBe(200);
    const list = await call(R.offerings.GET, { host: PUBLIC, path: "/x" });
    expect((list.json.offerings as { reference: string }[])[0].reference).toBe(ref);
    const detail = await call(R.offering.GET, { host: PUBLIC, path: "/x" }, { ref });
    expect(detail.status).toBe(200);
    const o = detail.json.offering as { documents: { id: string }[]; verification: { subject: string; status: string }[]; token: { code: string } };
    expect(o.token.code).toBe("HTWR");
    expect(o.documents.map(d => d.id)).toEqual([docs.offering]);
    expect(o.verification.find(v => v.subject === "valuation")?.status).toBe("verified");
    expect(String(detail.json.riskDisclosure)).toMatch(/not guaranteed/);
    expect((await call(R.doc.GET, { host: PUBLIC, path: "/x" }, { id: docs.offering })).status).toBe(200);
    expect((await call(R.doc.GET, { host: PUBLIC, path: "/x" }, { id: docs.ownership })).status).toBe(404);
  });

  let subId = "";
  it("subscriptions: closed by default, then minimums, attestations and one open request", async () => {
    const body = { amount: "500", investorAddress: INVESTOR_WALLET, eligibilityAttested: true, risksAcknowledged: true };
    expect((await call(R.subscribe.POST, { host: PUBLIC, path: "/x", body, jar: investor }, { ref })).status).toBe(403);
    const cur = await call(R.settings.GET, { host: ADMIN, path: "/x", jar: admin });
    await call(R.settings.PUT, { method: "PUT", host: ADMIN, path: "/x", body: { ...(cur.json.settings as object), subscriptionsOpen: true }, jar: admin });
    expect((await call(R.subscribe.POST, { host: PUBLIC, path: "/x", body: { ...body, amount: "10" }, jar: investor }, { ref })).status).toBe(400);
    expect((await call(R.subscribe.POST, { host: PUBLIC, path: "/x", body: { ...body, risksAcknowledged: false }, jar: investor }, { ref })).status).toBe(400);
    expect((await call(R.subscribe.POST, { host: PUBLIC, path: "/x", body, jar: issuer }, { ref })).status).toBe(400);
    const ok = await call(R.subscribe.POST, { host: PUBLIC, path: "/x", body, jar: investor }, { ref });
    expect(ok.status).toBe(201);
    subId = (ok.json.subscription as { id: string }).id;
    expect((await call(R.subscribe.POST, { host: PUBLIC, path: "/x", body, jar: investor }, { ref })).status).toBe(409);
  });

  it("issuer accepts, authorises the trustline and delivers — each on-chain step verified (Horizon mocked)", async () => {
    const act = (body: object, jar = issuer) => call(R.issuerSub.POST, { host: PUBLIC, path: "/x", body, jar }, { ref, id: subId });
    expect((await act({ action: "accept" }, stranger)).status).toBe(404);
    expect((await act({ action: "authorized", txHash: "b".repeat(64) })).status).toBe(409);
    expect((await act({ action: "accept" })).status).toBe(200);
    const h1 = "c".repeat(64);
    horizon = {
      [`/transactions/${h1}`]: { successful: true, source_account: ISSUER_WALLET, operation_count: 1 },
      [`/transactions/${h1}/operations?limit=200`]: { _embedded: { records: [{ type: "set_trust_line_flags", source_account: TOKEN_ISSUER, trustor: INVESTOR_WALLET, asset_code: "HTWR", asset_issuer: TOKEN_ISSUER, set_flags: [1] }] } }
    };
    expect((await act({ action: "authorized", txHash: "d".repeat(64) })).status).toBe(404);
    expect((await act({ action: "authorized", txHash: h1 })).status).toBe(200);
    const h2 = "e".repeat(64);
    horizon = {
      [`/transactions/${h2}`]: { successful: true, source_account: ISSUER_WALLET, operation_count: 1 },
      [`/transactions/${h2}/operations?limit=200`]: { _embedded: { records: [{ type: "payment", source_account: ISSUER_WALLET, from: ISSUER_WALLET, to: INVESTOR_WALLET, asset_code: "HTWR", asset_issuer: TOKEN_ISSUER, amount: "499.0000000" }] } }
    };
    expect((await act({ action: "delivered", txHash: h2 })).status).toBe(400);
    (horizon[`/transactions/${h2}/operations?limit=200`] as { _embedded: { records: { amount: string }[] } })._embedded.records[0].amount = "500.0000000";
    expect((await act({ action: "delivered", txHash: h2 })).status).toBe(200);
  });

  it("a recorded hash can't be reused for any other step (sequential)", async () => {
    // The delivery hash and the issuance hash are already in the registry; the pre-check refuses them before Horizon is called.
    const reg = await sql`select tx_hash, step from rwa_recorded_transactions order by recorded_at`;
    expect(reg.map(x => x.step)).toEqual(["issuance", "authorization", "delivery"]);
    const issuanceHash = reg[0].tx_hash as string;
    const r2 = await call(R.issuance.POST, { host: PUBLIC, path: "/x", body: { txHash: issuanceHash }, jar: issuer }, { ref });
    expect(r2.status).toBe(409);
  });

  it("concurrent attempts to record one hash for two subscriptions: exactly one succeeds", async () => {
    // Two investors name the same wallet, so one Stellar transaction is valid for both — the worst case.
    const SHARED = Keypair.random().publicKey();
    const body = { amount: "100", investorAddress: SHARED, eligibilityAttested: true, risksAcknowledged: true };
    const s1 = await call(R.subscribe.POST, { host: PUBLIC, path: "/x", body, jar: investor }, { ref });
    const s2 = await call(R.subscribe.POST, { host: PUBLIC, path: "/x", body, jar: stranger }, { ref });
    expect([s1.status, s2.status]).toEqual([201, 201]);
    const ids = [s1, s2].map(x => (x.json.subscription as { id: string }).id);
    for (const id of ids) expect((await call(R.issuerSub.POST, { host: PUBLIC, path: "/x", body: { action: "accept" }, jar: issuer }, { ref, id })).status).toBe(200);
    const h = "f".repeat(64);
    horizon = {
      [`/transactions/${h}`]: { successful: true, source_account: ISSUER_WALLET, operation_count: 1 },
      [`/transactions/${h}/operations?limit=200`]: { _embedded: { records: [{ type: "set_trust_line_flags", source_account: TOKEN_ISSUER, trustor: SHARED, asset_code: "HTWR", asset_issuer: TOKEN_ISSUER, set_flags: [1] }] } }
    };
    const results = await Promise.all(ids.map(id => call(R.issuerSub.POST, { host: PUBLIC, path: "/x", body: { action: "authorized", txHash: h }, jar: issuer }, { ref, id })));
    expect(results.map(x => x.status).sort()).toEqual([200, 409]);
    const recorded = await sql`select count(*)::int n from rwa_subscriptions where authorize_tx_hash = ${h}`;
    expect(recorded[0].n).toBe(1);
    expect((await sql`select count(*)::int n from rwa_recorded_transactions where tx_hash = ${h}`)[0].n).toBe(1);
    // The losing subscription is unchanged and can't take the hash afterwards either.
    const loser = ids[results.findIndex(x => x.status === 409)];
    expect((await sql`select status from rwa_subscriptions where id = ${loser}`)[0].status).toBe("accepted");
    expect((await call(R.issuerSub.POST, { host: PUBLIC, path: "/x", body: { action: "authorized", txHash: h }, jar: issuer }, { ref, id: loser })).status).toBe(409);
  });

  it("reservation and recording are atomic under real concurrency (10 parallel transactions, held open)", async () => {
    const { recordOnChainStep, TxHashReused } = await import("@/lib/server/rwa");
    const app = (await sql`select id from rwa_applications where reference = ${ref}`)[0].id as string;
    const subs = (await sql`select id from rwa_subscriptions where application_id = ${app} order by created_at`).map(x => x.id as string);
    const h = "9".repeat(64);
    let applied = 0;
    const attempts = Array.from({ length: 10 }, (_, i) => recordOnChainStep(h, i % 2 ? "authorization" : "delivery", { applicationId: app, subscriptionId: subs[i % subs.length] }, async tx => {
      await tx`select pg_sleep(0.15)`; // keep the transaction open so the others contend
      applied++;
      return true;
    }));
    const settled = await Promise.allSettled(attempts);
    expect(settled.filter(x => x.status === "fulfilled")).toHaveLength(1);
    const rejected = settled.filter((x): x is PromiseRejectedResult => x.status === "rejected");
    expect(rejected).toHaveLength(9);
    for (const x of rejected) expect(x.reason).toBeInstanceOf(TxHashReused);
    expect(applied).toBe(1);
    expect((await sql`select count(*)::int n from rwa_recorded_transactions where tx_hash = ${h}`)[0].n).toBe(1);
  });

  it("a failed recording rolls back its reservation, so nothing is half-recorded", async () => {
    const { recordOnChainStep } = await import("@/lib/server/rwa");
    const app = (await sql`select id from rwa_applications where reference = ${ref}`)[0].id as string;
    const sub = (await sql`select id from rwa_subscriptions where application_id = ${app} limit 1`)[0].id as string;
    const h = "8".repeat(64);
    await expect(recordOnChainStep(h, "delivery", { applicationId: app, subscriptionId: sub }, async () => false)).rejects.toMatchObject({ status: 409 });
    expect((await sql`select count(*)::int n from rwa_recorded_transactions where tx_hash = ${h}`)[0].n).toBe(0);
    await expect(recordOnChainStep(h, "delivery", { applicationId: app, subscriptionId: sub }, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect((await sql`select count(*)::int n from rwa_recorded_transactions where tx_hash = ${h}`)[0].n).toBe(0);
  });

  it("the database itself refuses duplicate hashes across steps and columns", async () => {
    const used = (await sql`select delivery_tx_hash from rwa_subscriptions where delivery_tx_hash is not null limit 1`)[0].delivery_tx_hash as string;
    const app = (await sql`select id from rwa_applications where reference = ${ref}`)[0].id as string;
    await expect(sql`insert into rwa_recorded_transactions (tx_hash, step, application_id) values (${used}, 'issuance', ${app})`).rejects.toThrow(/duplicate key/);
    const other = (await sql`select id from rwa_subscriptions where delivery_tx_hash is null limit 1`)[0].id as string;
    await expect(sql`update rwa_subscriptions set delivery_tx_hash = ${used} where id = ${other}`).rejects.toThrow(/duplicate key/);
    await expect(sql`insert into rwa_recorded_transactions (tx_hash, step, application_id) values ('not-a-hash', 'issuance', ${app})`).rejects.toThrow();
  });

  it("lifecycle: issuer reports, investor redemption request, admin records, suspension delists", async () => {
    const form = new FormData();
    form.set("kind", "valuation_update"); form.set("title", "Q3 independent valuation"); form.set("amount", "25500000"); form.set("currency", "USD");
    form.set("event_date", "2026-10-01"); form.set("public", "true"); form.set("file", new File([new Uint8Array(PDF)], "q3.pdf"));
    expect((await call(R.events.POST, { host: PUBLIC, path: "/x", form, jar: issuer }, { ref })).status).toBe(201);
    expect((await call(R.events.POST, { host: PUBLIC, path: "/x", body: { kind: "status_change", title: "fake" }, jar: issuer }, { ref })).status).toBe(400);
    expect((await call(R.redeem.POST, { host: PUBLIC, path: "/x", body: { amount: "100", details: "Annual window" }, jar: stranger }, { ref })).status).toBe(403);
    expect((await call(R.redeem.POST, { host: PUBLIC, path: "/x", body: { amount: "100", details: "Annual window" }, jar: investor }, { ref })).status).toBe(201);
    const ev = (await sql`select id from rwa_asset_events where kind = 'redemption_request'`)[0].id;
    expect((await call(R.events.PATCH, { method: "PATCH", host: PUBLIC, path: "/x", body: { eventId: ev, status: "acknowledged" }, jar: issuer }, { ref })).status).toBe(200);
    expect((await call(R.adminEvents.POST, { host: ADMIN, path: "/x", body: { kind: "inspection_report", title: "Site inspection", body: "No issues" }, jar: admin }, { ref })).status).toBe(201);
    const detail = await call(R.offering.GET, { host: PUBLIC, path: "/x" }, { ref });
    expect(JSON.stringify(detail.json.offering)).toContain("Q3 independent valuation");
    expect(JSON.stringify(detail.json.offering)).not.toContain("Site inspection");
    expect((await decide("suspend", "Custodian confirmation lapsed")).status).toBe(200);
    expect((await call(R.offering.GET, { host: PUBLIC, path: "/x" }, { ref })).status).toBe(404);
    expect((await call(R.subscribe.POST, { host: PUBLIC, path: "/x", body: { amount: "500", investorAddress: INVESTOR_WALLET, eligibilityAttested: true, risksAcknowledged: true }, jar: stranger }, { ref })).status).toBe(404);
    expect((await decide("reinstate", "Custodian confirmation renewed")).status).toBe(200);
    expect((await sql`select published from rwa_applications where reference = ${ref}`)[0].published).toBe(false);
  });

  it("every admin decision is in the audit log with actor, statuses and reason", async () => {
    const log = await call(R.audit.GET, { host: ADMIN, path: `/api/admin/audit?target=${ref}`, jar: admin });
    const actions = (log.json.entries as { action: string; actor_email: string }[]).map(e => e.action);
    for (const a of ["rwa.start_review", "rwa.request_info", "rwa.approve", "rwa.tokenization.authorized", "rwa.offering.listed", "rwa.suspend", "rwa.reinstate", "rwa.finding.recorded", "rwa.document.viewed"]) {
      expect(actions, a).toContain(a);
    }
  });

  it("an applicant can't promote themselves or reach admin APIs", async () => {
    const r = await call(R.adminApps.GET, { host: ADMIN, path: "/x", jar: issuer });
    expect(r.status).toBe(401);
    const roles = await sql`select distinct role from app_users where realm = 'public'`;
    expect(roles.map(x => x.role)).toEqual(["user"]);
  });
});
