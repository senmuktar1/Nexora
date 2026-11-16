import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { call, freshDatabase, newJar, TEST_DB } from "./helpers/db";

vi.mock("server-only", () => ({}));

/**
 * Admin authentication, bootstrap, MFA, host separation and authorization against a real
 * PostgreSQL database (TEST_DATABASE_URL). Skipped when no test database is configured.
 */
const ADMIN = "admin.nexora.test";
const PUBLIC = "nexora.test";
const FOUNDER = "founder@example.com";
const PW = "correct horse battery staple";

describe.skipIf(!TEST_DB)("admin portal (PostgreSQL)", () => {
  let sql: postgres.Sql;
  let R: Record<string, Record<string, (...a: never[]) => Promise<Response>>>;
  let totp: typeof import("@/lib/server/auth/totp");
  const jar = newJar();
  let secret = "";
  let enrolStep = 0;
  let recovery: string[] = [];

  beforeAll(async () => {
    const DB = await freshDatabase("admin");
    Object.assign(process.env, {
      DATABASE_URL: DB, ADMIN_HOST: ADMIN, NEXORA_ADMIN_EMAIL: FOUNDER, EMAIL_TEST_OUTBOX: "true",
      DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64")
    });
    delete process.env.RESEND_API_KEY;
    sql = postgres(DB, { max: 1, onnotice: () => {} });
    totp = await import("@/lib/server/auth/totp");
    R = {
      status: await import("@/app/api/admin/auth/status/route"),
      bootstrap: await import("@/app/api/admin/auth/bootstrap/route"),
      verify: await import("@/app/api/admin/auth/verify/route"),
      login: await import("@/app/api/admin/auth/login/route"),
      logout: await import("@/app/api/admin/auth/logout/route"),
      mfaSetup: await import("@/app/api/admin/auth/mfa/setup/route"),
      mfaEnable: await import("@/app/api/admin/auth/mfa/enable/route"),
      mfaVerify: await import("@/app/api/admin/auth/mfa/verify/route"),
      overview: await import("@/app/api/admin/overview/route"),
      audit: await import("@/app/api/admin/audit/route"),
      settings: await import("@/app/api/admin/settings/route"),
      register: await import("@/app/api/account/register/route"),
      accVerify: await import("@/app/api/account/verify/route")
    } as never;
  });

  afterAll(async () => {
    await sql?.end();
    const { __closeDbForTests } = await import("@/lib/server/db");
    await __closeDbForTests();
  });

  const lastToken = async (to: string) => {
    const rows = await sql`select body from email_outbox where to_email = ${to} order by id desc limit 1`;
    return /token=([A-Za-z0-9_-]+)/.exec(rows[0]?.body as string ?? "")?.[1] ?? "";
  };
  type H = Parameters<typeof call>[0];
  const h = (name: string, method = "POST") => R[name][method] as unknown as H;

  it("admin routes don't exist on the public host", async () => {
    expect((await call(h("status", "GET"), { host: PUBLIC, path: "/api/admin/auth/status" })).status).toBe(404);
    expect((await call(h("overview", "GET"), { host: PUBLIC, path: "/api/admin/overview" })).status).toBe(404);
    expect((await call(h("login"), { host: PUBLIC, path: "/api/admin/auth/login", body: { email: FOUNDER, password: PW } })).status).toBe(404);
  });

  it("reports bootstrap availability without revealing the configured email", async () => {
    const r = await call(h("status", "GET"), { host: ADMIN, path: "/api/admin/auth/status" });
    expect(r.status).toBe(200);
    expect(r.json.bootstrapAvailable).toBe(true);
    expect(r.text).not.toContain(FOUNDER);
  });

  it("rejects bootstrap with any other email, and records the attempt", async () => {
    const r = await call(h("bootstrap"), { host: ADMIN, path: "/api/admin/auth/bootstrap", body: { email: "attacker@example.com", password: PW } });
    expect(r.status).toBe(403);
    expect((await sql`select count(*)::int n from app_users`)[0].n).toBe(0);
    expect((await sql`select count(*)::int n from admin_audit_log where action = 'admin.bootstrap.rejected'`)[0].n).toBe(1);
  });

  it("refuses cross-site requests (CSRF)", async () => {
    const r = await call(h("bootstrap"), { host: ADMIN, path: "/api/admin/auth/bootstrap", body: { email: FOUNDER, password: PW }, origin: "https://evil.example" });
    expect(r.status).toBe(403);
    const r2 = await call(h("bootstrap"), { host: ADMIN, path: "/api/admin/auth/bootstrap", body: { email: FOUNDER, password: PW }, origin: null });
    expect(r2.status).toBe(403);
  });

  it("starts bootstrap for the configured email and sends a verification link", async () => {
    const r = await call(h("bootstrap"), { host: ADMIN, path: "/api/admin/auth/bootstrap", body: { email: " Founder@Example.com ", password: PW } });
    expect(r.status).toBe(200);
    const u = (await sql`select realm, role, status, email_verified_at from app_users`)[0];
    expect(u).toMatchObject({ realm: "admin", role: "super_admin", status: "pending", email_verified_at: null });
    expect(await lastToken(FOUNDER)).not.toBe("");
  });

  it("can't sign in before the email is verified", async () => {
    const r = await call(h("login"), { host: ADMIN, path: "/api/admin/auth/login", body: { email: FOUNDER, password: PW } });
    expect(r.status).toBe(403);
  });

  it("verification needs the mailbox link AND the password", async () => {
    const token = await lastToken(FOUNDER);
    expect((await call(h("verify"), { host: ADMIN, path: "/api/admin/auth/verify", body: { token, password: "wrong password here" } })).status).toBe(400);
    expect((await call(h("verify"), { host: ADMIN, path: "/api/admin/auth/verify", body: { token: "x".repeat(43), password: PW } })).status).toBe(400);
    const ok = await call(h("verify"), { host: ADMIN, path: "/api/admin/auth/verify", body: { token, password: PW }, jar });
    expect(ok.status).toBe(200);
    expect(ok.json.next).toBe("mfa_setup");
    expect([...jar.keys()]).toEqual(["__Host-nx_admin"]);
    // Single use.
    expect((await call(h("verify"), { host: ADMIN, path: "/api/admin/auth/verify", body: { token, password: PW } })).status).toBe(400);
  });

  it("session cookie is HttpOnly, Secure, SameSite=Strict, host-only", async () => {
    const j = newJar();
    const r = await call(h("login"), { host: ADMIN, path: "/api/admin/auth/login", body: { email: FOUNDER, password: PW }, jar: j });
    const cookie = r.headers.getSetCookie()[0];
    expect(cookie).toMatch(/^__Host-nx_admin=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).toMatch(/Path=\//);
  });

  it("admin APIs stay closed until MFA is enrolled", async () => {
    expect((await call(h("overview", "GET"), { host: ADMIN, path: "/api/admin/overview", jar })).status).toBe(401);
  });

  it("enrols the authenticator and completes the one-time bootstrap", async () => {
    const setup = await call(h("mfaSetup"), { host: ADMIN, path: "/api/admin/auth/mfa/setup", body: {}, jar });
    expect(setup.status).toBe(200);
    secret = setup.json.secret as string;
    expect(String(setup.json.qr)).toMatch(/^data:image\/png;base64,/);
    const stored = (await sql`select mfa_secret_enc from app_users`)[0].mfa_secret_enc as string;
    expect(stored).not.toContain(secret);
    expect((await call(h("mfaEnable"), { host: ADMIN, path: "/api/admin/auth/mfa/enable", body: { code: "000000" }, jar })).status).toBe(400);
    enrolStep = totp.currentStep() - 1;
    const code = totp.totpAt(secret, enrolStep);
    const ok = await call(h("mfaEnable"), { host: ADMIN, path: "/api/admin/auth/mfa/enable", body: { code }, jar });
    expect(ok.status).toBe(200);
    recovery = ok.json.recoveryCodes as string[];
    expect(recovery).toHaveLength(10);
    expect((await sql`select count(*)::int n from admin_bootstrap`)[0].n).toBe(1);
    expect((await call(h("overview", "GET"), { host: ADMIN, path: "/api/admin/overview", jar })).status).toBe(200);
  });

  it("bootstrap can never run again", async () => {
    const status = await call(h("status", "GET"), { host: ADMIN, path: "/api/admin/auth/status" });
    expect(status.json.bootstrapAvailable).toBe(false);
    const r = await call(h("bootstrap"), { host: ADMIN, path: "/api/admin/auth/bootstrap", body: { email: FOUNDER, password: PW + "x" } });
    expect(r.status).toBe(403);
    await expect(sql`insert into admin_bootstrap (admin_user_id, admin_email) select id, email from app_users limit 1`).rejects.toThrow();
  });

  it("the database refuses a second Super Admin", async () => {
    await expect(sql`insert into app_users (realm, email, password_hash, role, status) values ('admin', 'second@example.com', 'x', 'super_admin', 'active')`).rejects.toThrow(/one_super_admin/);
    await expect(sql`insert into app_users (realm, email, password_hash, role, status) values ('public', 'x@example.com', 'x', 'super_admin', 'active')`).rejects.toThrow();
  });

  it("sign-in requires a fresh TOTP code; replays are refused", async () => {
    const j = newJar();
    const r = await call(h("login"), { host: ADMIN, path: "/api/admin/auth/login", body: { email: FOUNDER, password: PW }, jar: j });
    expect(r.json.next).toBe("mfa");
    expect((await call(h("overview", "GET"), { host: ADMIN, path: "/api/admin/overview", jar: j })).status).toBe(401);
    // The code used for enrolment (previous step) is now stale/replayed.
    expect((await call(h("mfaVerify"), { host: ADMIN, path: "/api/admin/auth/mfa/verify", body: { code: totp.totpAt(secret, enrolStep) }, jar: j })).status).toBe(400);
    const code = totp.totpAt(secret, totp.currentStep());
    expect((await call(h("mfaVerify"), { host: ADMIN, path: "/api/admin/auth/mfa/verify", body: { code }, jar: j })).status).toBe(200);
    expect((await call(h("overview", "GET"), { host: ADMIN, path: "/api/admin/overview", jar: j })).status).toBe(200);
    const j2 = newJar();
    await call(h("login"), { host: ADMIN, path: "/api/admin/auth/login", body: { email: FOUNDER, password: PW }, jar: j2 });
    expect((await call(h("mfaVerify"), { host: ADMIN, path: "/api/admin/auth/mfa/verify", body: { code }, jar: j2 })).status).toBe(400);
  });

  it("a recovery code works exactly once", async () => {
    const j = newJar();
    await call(h("login"), { host: ADMIN, path: "/api/admin/auth/login", body: { email: FOUNDER, password: PW }, jar: j });
    expect((await call(h("mfaVerify"), { host: ADMIN, path: "/api/admin/auth/mfa/verify", body: { recoveryCode: recovery[0] }, jar: j })).status).toBe(200);
    const j2 = newJar();
    await call(h("login"), { host: ADMIN, path: "/api/admin/auth/login", body: { email: FOUNDER, password: PW }, jar: j2 });
    expect((await call(h("mfaVerify"), { host: ADMIN, path: "/api/admin/auth/mfa/verify", body: { recoveryCode: recovery[0] }, jar: j2 })).status).toBe(400);
  });

  it("rejects unauthorised emails at sign-in, including a public account with the founder's email", async () => {
    // A public account with the same email is a different realm: it never grants admin access.
    await call(h("register"), { host: PUBLIC, path: "/api/account/register", body: { email: FOUNDER, password: PW, role: "super_admin" } });
    const pub = await sql`select realm, role from app_users where realm = 'public'`;
    expect(pub[0]).toMatchObject({ realm: "public", role: "user" });
    const r = await call(h("login"), { host: ADMIN, path: "/api/admin/auth/login", body: { email: "someone@example.com", password: PW } });
    expect(r.status).toBe(401);
    expect(r.json.error).toBe("Email or password is incorrect.");
  });

  it("locks an email after repeated failures", async () => {
    for (let i = 0; i < 5; i++) await call(h("login"), { host: ADMIN, path: "/api/admin/auth/login", body: { email: FOUNDER, password: "not the password!" }, headers: { "x-forwarded-for": `10.0.0.${i}` } });
    const r = await call(h("login"), { host: ADMIN, path: "/api/admin/auth/login", body: { email: FOUNDER, password: PW }, headers: { "x-forwarded-for": "10.0.1.1" } });
    expect(r.status).toBe(429);
    await sql`delete from login_attempts`;
  });

  it("changing NEXORA_ADMIN_EMAIL never transfers access: existing sessions and sign-in stop working", async () => {
    expect((await call(h("overview", "GET"), { host: ADMIN, path: "/api/admin/overview", jar })).status).toBe(200);
    process.env.NEXORA_ADMIN_EMAIL = "new-owner@example.com";
    try {
      expect((await call(h("overview", "GET"), { host: ADMIN, path: "/api/admin/overview", jar })).status).toBe(401);
      expect((await call(h("login"), { host: ADMIN, path: "/api/admin/auth/login", body: { email: FOUNDER, password: PW } })).status).toBe(401);
      expect((await call(h("bootstrap"), { host: ADMIN, path: "/api/admin/auth/bootstrap", body: { email: "new-owner@example.com", password: PW } })).status).toBe(403);
      expect((await sql`select email from app_users where role = 'super_admin'`)[0].email).toBe(FOUNDER);
    } finally {
      process.env.NEXORA_ADMIN_EMAIL = FOUNDER;
      await sql`delete from login_attempts`;
    }
  });

  it("settings and audit log require an MFA-verified admin; changes are audited", async () => {
    const cur = await call(h("settings", "GET"), { host: ADMIN, path: "/api/admin/settings", jar });
    const next = { ...(cur.json.settings as object), subscriptionsOpen: true };
    expect((await call(h("settings", "PUT"), { method: "PUT", host: ADMIN, path: "/api/admin/settings", body: next, jar, origin: null })).status).toBe(403);
    expect((await call(h("settings", "PUT"), { method: "PUT", host: ADMIN, path: "/api/admin/settings", body: next, jar })).status).toBe(200);
    const log = await call(h("audit", "GET"), { host: ADMIN, path: "/api/admin/audit?action=platform.", jar });
    expect((log.json.entries as { action: string }[])[0].action).toBe("platform.settings.updated");
    expect((await call(h("audit", "GET"), { host: ADMIN, path: "/api/admin/audit" })).status).toBe(401);
  });

  it("logout ends the session", async () => {
    const j = newJar();
    await call(h("login"), { host: ADMIN, path: "/api/admin/auth/login", body: { email: FOUNDER, password: PW }, jar: j });
    await call(h("mfaVerify"), { host: ADMIN, path: "/api/admin/auth/mfa/verify", body: { recoveryCode: recovery[1] }, jar: j });
    const saved = new Map(j);
    expect((await call(h("logout"), { host: ADMIN, path: "/api/admin/auth/logout", body: {}, jar: j })).status).toBe(200);
    expect((await call(h("overview", "GET"), { host: ADMIN, path: "/api/admin/overview", jar: saved })).status).toBe(401);
  });

  it("row-level security is enabled on every table (deny-by-default for Supabase API roles)", async () => {
    const rows = await sql`select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'`;
    expect(rows.length).toBeGreaterThanOrEqual(15);
    for (const r of rows) expect(r.relrowsecurity, r.relname as string).toBe(true);
  });
});
