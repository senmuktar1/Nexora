import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const req = (q = "") => ({ nextUrl: new URL("http://x/api/health" + q) }) as never;

describe("health", () => {
  it("liveness makes no external calls", async () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    const { GET } = await import("@/app/api/health/route");
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(f).not.toHaveBeenCalled();
  });
  it("readiness checks Horizon is on Mainnet and never echoes URLs or keys", async () => {
    vi.stubEnv("STELLAR_EXPERT_API_KEY", "secret-key-value");
    vi.stubEnv("STELLAR_MAINNET_SOROBAN_RPC_URL", "");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ network_passphrase: "Public Global Stellar Network ; September 2015" })));
    const { GET } = await import("@/app/api/health/route");
    const res = await GET(req("?deep=1"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ horizon: { reachable: true, mainnet: true }, soroban: { configured: false, verified: false }, providers: { stellarExpertKey: true } });
    expect(JSON.stringify(body)).not.toMatch(/secret-key-value|https?:\/\//);
  });
  it("readiness fails when Horizon is on the wrong network", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ network_passphrase: "Test SDF Network ; September 2015" })));
    const { GET } = await import("@/app/api/health/route");
    expect((await GET(req("?deep=1"))).status).toBe(503);
  });
});

describe("Horizon config", () => {
  it("requires https and falls back to the SDF default", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { resolveHorizonUrl, DEFAULT_HORIZON_URL } = await import("@/lib/server/horizon");
    expect(resolveHorizonUrl(undefined)).toBe(DEFAULT_HORIZON_URL);
    expect(resolveHorizonUrl("https://horizon.example.com/")).toBe("https://horizon.example.com");
    expect(resolveHorizonUrl("http://insecure.example.com")).toBe(DEFAULT_HORIZON_URL);
  });
});
