import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const behaviour = { passphrase: "Public Global Stellar Network ; September 2015", health: "healthy", fail: false, calls: 0 };
vi.mock("@stellar/stellar-sdk", async (orig) => {
  const actual = await orig<typeof import("@stellar/stellar-sdk")>();
  class FakeServer {
    constructor(public url: string) {}
    async getNetwork() { behaviour.calls++; if (behaviour.fail) throw new Error("ECONNREFUSED https://x?apikey=s3cret"); return { passphrase: behaviour.passphrase }; }
    async getHealth() { return { status: behaviour.health, latestLedger: 1 }; }
  }
  return { ...actual, rpc: { ...actual.rpc, Server: FakeServer } };
});
const soroban = await import("@/lib/server/soroban");

describe("Soroban RPC verification (no fallback)", () => {
  beforeEach(() => {
    soroban.__resetSorobanStateForTests();
    Object.assign(behaviour, { passphrase: "Public Global Stellar Network ; September 2015", health: "healthy", fail: false, calls: 0 });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("is unavailable when no endpoint is configured", async () => {
    vi.stubEnv("STELLAR_MAINNET_SOROBAN_RPC_URL", "");
    expect(await soroban.ensureVerifiedMainnetRpc()).toBe(false);
    expect(() => soroban.verifiedMainnetRpcUrl()).toThrow();
    expect(soroban.sorobanStatus()).toMatchObject({ configured: false, verified: false });
  });

  it("rejects non-HTTPS endpoints", async () => {
    vi.stubEnv("STELLAR_MAINNET_SOROBAN_RPC_URL", "http://rpc.example.com");
    expect(await soroban.ensureVerifiedMainnetRpc()).toBe(false);
  });

  it("rejects an endpoint on the wrong network", async () => {
    vi.stubEnv("STELLAR_MAINNET_SOROBAN_RPC_URL", "https://rpc.example.com");
    behaviour.passphrase = "Test SDF Network ; September 2015";
    expect(await soroban.ensureVerifiedMainnetRpc()).toBe(false);
  });

  it("rejects an unhealthy endpoint and an unreachable one", async () => {
    vi.stubEnv("STELLAR_MAINNET_SOROBAN_RPC_URL", "https://rpc.example.com");
    behaviour.health = "unhealthy";
    expect(await soroban.ensureVerifiedMainnetRpc()).toBe(false);
    soroban.__resetSorobanStateForTests();
    behaviour.fail = true;
    expect(await soroban.ensureVerifiedMainnetRpc()).toBe(false);
  });

  it("accepts a healthy Mainnet endpoint and caches the verification", async () => {
    vi.stubEnv("STELLAR_MAINNET_SOROBAN_RPC_URL", "https://rpc.example.com");
    expect(await soroban.ensureVerifiedMainnetRpc()).toBe(true);
    expect(await soroban.ensureVerifiedMainnetRpc()).toBe(true);
    expect(behaviour.calls).toBe(1);
    expect(soroban.verifiedMainnetRpcUrl()).toBe("https://rpc.example.com/");
    expect(soroban.sorobanStatus()).toMatchObject({ configured: true, verified: true });
  });

  it("never falls back to a hard-coded endpoint", async () => {
    const { readFileSync } = await import("node:fs");
    const { globSync } = await import("node:fs");
    for (const f of globSync("src/**/*.ts")) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/soroban-rpc\.creit\.tech|mainnet\.sorobanrpc\.com/);
    }
  });
});
