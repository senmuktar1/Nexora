import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { countryFromHeaders, parseCountryList } from "@/lib/region";

vi.mock("server-only", () => ({}));
afterEach(() => vi.unstubAllEnvs());
const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;

describe("regional restrictions", () => {
  it("parses only valid ISO codes; empty means no restriction", () => {
    expect([...parseCountryList(" us, gb ,XYZ,1A,")]).toEqual(["US", "GB"]);
    expect(parseCountryList(undefined).size).toBe(0);
  });

  it("reads only the platform's own country header", () => {
    const h = new Headers({ "x-vercel-ip-country": "US", "x-country": "FR", "cf-ipcountry": "DE" });
    expect(countryFromHeaders(h, env({}))).toBeNull(); // unknown platform: no forged headers trusted
    expect(countryFromHeaders(h, env({ VERCEL: "1" }))).toBe("US");
    expect(countryFromHeaders(h, env({ NETLIFY: "true" }))).toBe("FR");
    expect(countryFromHeaders(h, env({ GEO_COUNTRY_HEADER: "CF-IPCountry" }))).toBe("DE");
  });

  it("proxy: blocks pages and APIs for restricted countries, keeps legal pages and health", async () => {
    vi.stubEnv("RESTRICTED_COUNTRIES", "US");
    vi.stubEnv("VERCEL", "1");
    const { proxy } = await import("@/proxy");
    const call = (path: string, country = "US") => proxy(new NextRequest(`https://nexora.example${path}`, { headers: { "x-vercel-ip-country": country } }));
    expect(call("/api/stellar/submit").status).toBe(451);
    expect(call("/swap").headers.get("x-middleware-rewrite")).toContain("/restricted-regions?blocked=1");
    expect(call("/terms").headers.get("x-middleware-rewrite")).toBeNull();
    expect(call("/api/health").status).toBe(200);
    expect(call("/swap", "FR").headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("proxy is a no-op when nothing is restricted", async () => {
    vi.stubEnv("RESTRICTED_COUNTRIES", "");
    const { proxy } = await import("@/proxy");
    const res = proxy(new NextRequest("https://nexora.example/api/stellar/submit", { headers: { "x-vercel-ip-country": "US" } }));
    expect(res.status).toBe(200);
  });
});

describe("legal configuration", () => {
  it("uses only owner-provided values; nothing assumed", async () => {
    const { legalConfig } = await import("@/lib/legal-config");
    expect(legalConfig(env({}))).toEqual({ operator: null, contact: null, governingLaw: null, effectiveDate: null, approved: false, restrictedCountries: [] });
    const c = legalConfig(env({ LEGAL_OPERATOR_NAME: "Acme Ltd", LEGAL_CONTACT_EMAIL: "not-an-email", LEGAL_DOCS_APPROVED: "true", RESTRICTED_COUNTRIES: "gb,us" }));
    expect(c).toMatchObject({ operator: "Acme Ltd", contact: null, approved: true, restrictedCountries: ["GB", "US"] });
  });
});
