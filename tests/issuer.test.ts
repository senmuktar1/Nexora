import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

vi.mock("server-only", () => ({}));
const { fetchStellarToml, isPublicAddress, validDomain, TomlError } = await import("@/lib/server/toml");

const pub = async () => [{ address: "93.184.216.34", family: 4 }];
const priv = async () => [{ address: "10.0.0.5", family: 4 }];
const code = (e: unknown) => e instanceof TomlError ? e.code : String(e);

afterEach(() => vi.unstubAllGlobals());

describe("stellar.toml fetcher (SSRF hardening)", () => {
  it("validates domains and addresses", () => {
    expect(validDomain("example.com")).toBe(true);
    expect(validDomain("127.0.0.1")).toBe(false);
    expect(validDomain("localhost")).toBe(false);
    expect(validDomain("evil.internal")).toBe(false);
    expect(validDomain("a b.com")).toBe(false);
    expect(isPublicAddress("10.1.2.3")).toBe(false);
    expect(isPublicAddress("169.254.169.254")).toBe(false);
    expect(isPublicAddress("::1")).toBe(false);
    expect(isPublicAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicAddress("8.8.8.8")).toBe(true);
  });

  it("refuses domains resolving to private addresses (no request made)", async () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    await expect(fetchStellarToml("example.com", priv as never)).rejects.toSatisfy(e => code(e) === "blocked_address");
    expect(f).not.toHaveBeenCalled();
  });

  it("does not follow redirects and caps size", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      expect(init.redirect).toBe("manual");
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } });
    }));
    await expect(fetchStellarToml("example.com", pub as never)).rejects.toSatisfy(e => code(e) === "unavailable");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("A=" + "x".repeat(200_000))));
    await expect(fetchStellarToml("example.com", pub as never)).rejects.toSatisfy(e => code(e) === "too_large");
  });

  it("parses a valid toml", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('[DOCUMENTATION]\nORG_NAME="Acme"\n[[CURRENCIES]]\ncode="ACME"\nissuer="G"\n')));
    const toml = await fetchStellarToml("example.com", pub as never);
    expect((toml.CURRENCIES as { code: string }[])[0].code).toBe("ACME");
  });
});

describe("issuer evidence route", () => {
  const issuer = Keypair.random().publicKey();
  function horizon(homeDomain: string | null, tomlBody: string | null, signers = [{ key: issuer, weight: 1 }]) {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const u = String(input);
      if (u.includes("/accounts/")) return Response.json({ home_domain: homeDomain ?? undefined, flags: { auth_required: true, auth_revocable: true, auth_clawback_enabled: false }, thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 }, signers });
      if (u.includes("/assets?")) return Response.json({ _embedded: { records: [{ accounts: { authorized: 42 }, balances: { authorized: "1000.0000000" } }] } });
      if (u.includes("stellar.toml")) return tomlBody === null ? new Response("", { status: 404 }) : new Response(tomlBody);
      throw new Error("unexpected " + u);
    }));
  }
  vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }] }));
  const call = async () => {
    const { GET } = await import("@/app/api/stellar/issuer/route");
    const req = { nextUrl: new URL(`http://x/api/stellar/issuer?asset=ACME:${issuer}`), headers: new Headers({ "x-forwarded-for": Math.random().toString() }) };
    return (await GET(req as never)).json();
  };

  it("reports a two-way domain link only when the toml lists this exact asset", async () => {
    horizon("acme.example", `[[CURRENCIES]]\ncode="ACME"\nissuer="${issuer}"\nname="Acme Fund"\nis_asset_anchored=true\nanchor_asset_type="bond"\n`);
    const linked = await call();
    expect(linked.domainLink.status).toBe("linked");
    expect(linked.published).toMatchObject({ name: "Acme Fund", isAnchored: true, anchorAssetType: "bond" });
    expect(linked.onChain).toMatchObject({ authRequired: true, holders: 42, circulating: "1000.0000000", issuerLocked: false });

    horizon("acme.example", `[[CURRENCIES]]\ncode="ACME"\nissuer="${Keypair.random().publicKey()}"\n`);
    const impostor = await call();
    expect(impostor.domainLink.status).toBe("not_listed");
    expect(impostor.published).toBeNull();

    horizon(null, null);
    expect((await call()).domainLink.status).toBe("no_domain");
  });

  it("detects a locked issuer", async () => {
    horizon(null, null, [{ key: issuer, weight: 0 }]);
    expect((await call()).onChain.issuerLocked).toBe(true);
  });
});

describe("token icon safety", () => {
  it("accepts raster magic bytes only (never SVG)", async () => {
    const { sniffImage } = await import("@/lib/server/image");
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImage(Buffer.from("<html>"))).toBeNull();
  });
});
