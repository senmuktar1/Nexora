import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

/** Security primitives and host routing (no database needed). */
describe("TOTP (RFC 6238)", async () => {
  const { base32Decode, base32Encode, totpAt, verifyTotp } = await import("@/lib/server/auth/totp");
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it("matches the RFC 6238 SHA-1 test vectors (last 6 digits)", () => {
    expect(totpAt(secret, Math.floor(59 / 30))).toBe("287082");
    expect(totpAt(secret, Math.floor(1111111109 / 30))).toBe("081804");
    expect(totpAt(secret, Math.floor(2000000000 / 30))).toBe("279037");
  });
  it("base32 round-trips", () => {
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
  });
  it("accepts ±1 step only and rejects malformed codes", () => {
    const now = 1_800_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(secret, totpAt(secret, step), now)).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step - 2), now)).toBeNull();
    expect(verifyTotp(secret, "12345", now)).toBeNull();
    expect(verifyTotp(secret, "abcdef", now)).toBeNull();
  });
});

describe("passwords and encryption", async () => {
  const c = await import("@/lib/server/crypto");
  it("scrypt hashes verify and differ per salt", async () => {
    const a = await c.hashPassword("correct horse battery staple");
    const b = await c.hashPassword("correct horse battery staple");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await c.verifyPassword("correct horse battery staple", a)).toBe(true);
    expect(await c.verifyPassword("correct horse battery stapl", a)).toBe(false);
    expect(await c.verifyPassword("x", "not-a-hash")).toBe(false);
  });
  it("password policy", () => {
    expect(c.passwordProblem("short")).toMatch(/12/);
    expect(c.passwordProblem("aaaaaaaaaaaaaaaa")).toMatch(/repetitive/);
    expect(c.passwordProblem("correct horse battery")).toBeNull();
  });
  it("AES-256-GCM with per-record binding; tampering and wrong record fail", () => {
    process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
    const { iv, ciphertext } = c.encryptBytes("document", Buffer.from("secret deed"), "doc-1");
    expect(c.decryptBytes("document", iv, ciphertext, "doc-1").toString()).toBe("secret deed");
    expect(() => c.decryptBytes("document", iv, ciphertext, "doc-2")).toThrow();
    expect(() => c.decryptBytes("mfa", iv, ciphertext, "doc-1")).toThrow();
    const bad = Buffer.from(ciphertext); bad[0] ^= 1;
    expect(() => c.decryptBytes("document", iv, bad, "doc-1")).toThrow();
  });
  it("refuses to run without a valid 32-byte key", () => {
    process.env.DATA_ENCRYPTION_KEY = "dG9vLXNob3J0";
    expect(c.encryptionConfigured()).toBe(false);
    expect(() => c.encryptBytes("document", Buffer.from("x"), "a")).toThrow(c.EncryptionUnavailable);
  });
});

describe("documents and token configuration validation", async () => {
  const rwa = await import("@/lib/server/rwa");
  it("sniffs real content, not the declared type", () => {
    expect(rwa.sniffDocumentType(Buffer.from("%PDF-1.7 ..."))).toBe("application/pdf");
    expect(rwa.sniffDocumentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(rwa.sniffDocumentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(rwa.sniffDocumentType(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(rwa.sniffDocumentType(Buffer.from("<html>"))).toBeNull();
  });
  it("sanitises filenames", () => {
    expect(rwa.safeFilename("../../etc/passwd")).toBe("passwd");
    expect(rwa.safeFilename("C:\\x\\deed\".pdf")).toBe("deed_.pdf");
    expect(rwa.safeFilename("...hidden")).toBe("hidden");
  });
  it("references are unique-format", () => {
    const refs = new Set(Array.from({ length: 200 }, () => rwa.newReference()));
    expect(refs.size).toBe(200);
    for (const r of refs) expect(r).toMatch(/^RWA-\d{4}-[A-Z2-7]{6}$/);
  });
  it("token configuration rejects bad values", () => {
    const good = { token_code: "htwr", total_supply: "1000000", price_amount: "25", price_currency: "usd", min_investment: "100",
      token_rights: "x".repeat(12), ownership_structure: "x".repeat(12), distribution_rules: "x".repeat(12), investor_eligibility: "x".repeat(12),
      transfer_restrictions: "x".repeat(12), redemption_terms: "x".repeat(12), distributor_address: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" };
    expect(rwa.parseTokenConfig(good)).toMatchObject({ token_code: "HTWR", price_currency: "USD", clawback_enabled: true });
    for (const bad of [{ token_code: "XLM" }, { token_code: "TOO-LONG-CODE!" }, { total_supply: "0" }, { total_supply: "1e9" }, { min_investment: "-1" },
      { distributor_address: "SBADKEY" }, { token_rights: "short" }, { total_supply: "99999999999999" }]) {
      expect(() => rwa.parseTokenConfig({ ...good, ...bad })).toThrow();
    }
  });
  it("compares Stellar amounts exactly", () => {
    expect(rwa.sameAmount("500", "500.0000000")).toBe(true);
    expect(rwa.sameAmount("500.0000001", "500")).toBe(false);
    expect(rwa.sameAmount("abc", "1")).toBe(false);
  });
});

describe("permissions", async () => {
  const { can, permissionsOf } = await import("@/lib/server/auth/guard");
  it("public users have no admin permissions; staff roles are limited", () => {
    expect(permissionsOf("user")).toEqual([]);
    expect(can("user", "applications.read")).toBe(false);
    expect(can("super_admin", "settings.manage")).toBe(true);
    expect(can("reviewer", "applications.review")).toBe(true);
    expect(can("reviewer", "applications.decide")).toBe(false);
    expect(can("reviewer", "tokenization.authorize")).toBe(false);
    expect(can("compliance", "settings.manage")).toBe(false);
  });
});

describe("host separation (proxy)", async () => {
  const { proxy } = await import("@/proxy");
  const req = (host: string, path: string) => new NextRequest(`https://${host}${path}`, { headers: { host } });
  it("hides the admin portal everywhere except ADMIN_HOST", () => {
    process.env.ADMIN_HOST = "admin.nexora.com";
    expect(proxy(req("nexora.com", "/api/admin/overview")).status).toBe(404);
    expect(proxy(req("nexora.com", "/admin")).headers.get("x-middleware-rewrite")).toContain("/__not-found");
    expect(proxy(req("admin.nexora.com", "/admin/applications")).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(req("admin.nexora.com", "/api/admin/overview")).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(req("admin.nexora.com", "/api/stellar/network")).status).toBe(404);
    expect(proxy(req("admin.nexora.com", "/swap")).headers.get("location")).toBe("https://admin.nexora.com/admin");
    expect(proxy(req("ADMIN.NEXORA.COM:443", "/admin")).headers.get("x-middleware-next")).toBe("1");
  });
  it("disables the portal entirely when ADMIN_HOST is unset", () => {
    delete process.env.ADMIN_HOST;
    expect(proxy(req("admin.nexora.com", "/api/admin/overview")).status).toBe(404);
    expect(proxy(req("nexora.com", "/admin")).headers.get("x-middleware-rewrite")).toContain("/__not-found");
  });
});
