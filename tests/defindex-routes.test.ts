import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Address, Keypair, nativeToScVal } from "@stellar/stellar-sdk";

vi.mock("server-only", () => ({}));

const VAULT = "CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS";
const ASSET = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const me = Keypair.random().publicKey();
const state = { simFail: false };

vi.mock("@stellar/stellar-sdk", async (orig) => {
  const actual = await orig<typeof import("@stellar/stellar-sdk")>();
  class FakeServer {
    async getNetwork() { return { passphrase: actual.Networks.PUBLIC }; }
    async getHealth() { return { status: "healthy", latestLedger: 1 }; }
    async getAccount(id: string) { return new actual.Account(id, "77"); }
    async simulateTransaction(tx: { operations: { func: { invokeContract: { functionName: unknown } } }[] }) {
      const fn = String(tx.operations[0].func.invokeContract.functionName);
      if (state.simFail && (fn === "deposit" || fn === "withdraw")) return { error: "HostError: Error(Contract, #10)" };
      const ret: Record<string, unknown> = {
        get_assets: actual.nativeToScVal([{ address: new actual.Address(ASSET), strategies: [] }]),
        symbol: actual.nativeToScVal("USDC"), decimals: actual.nativeToScVal(7, { type: "u32" }), name: actual.nativeToScVal("Vault"),
        total_supply: actual.nativeToScVal(1000n, { type: "i128" }), balance: actual.nativeToScVal(0n, { type: "i128" }),
        get_asset_amounts_per_shares: actual.nativeToScVal([1n], { type: ["i128"] } as never),
        deposit: actual.nativeToScVal(null), withdraw: actual.nativeToScVal(null)
      };
      return { result: { retval: ret[fn] ?? actual.nativeToScVal(null) }, latestLedger: 1 };
    }
  }
  return { ...actual, rpc: { ...actual.rpc, Server: FakeServer,
    Api: { ...actual.rpc.Api, isSimulationSuccess: (s: { error?: unknown }) => !s.error },
    assembleTransaction: (tx: unknown) => ({ build: () => tx }) } };
});

const listed = (vaults: string[]) => vi.stubGlobal("fetch", vi.fn(async () => Response.json({ vaults: vaults.map(address => ({ address })) })));
const post = async (body: unknown) => {
  const { POST } = await import("@/app/api/stellar/defindex/build/route");
  return POST(new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": Math.random().toString() } }) as never);
};

beforeEach(() => { vi.stubEnv("STELLAR_MAINNET_SOROBAN_RPC_URL", "https://rpc.example.com"); state.simFail = false; vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

describe("DeFindex build route", () => {
  it("rejects invalid input before touching the network", async () => {
    expect((await post({ action: "drain", vault: VAULT, wallet: me })).status).toBe(400);
    expect((await post({ action: "deposit", vault: VAULT, wallet: me, amounts: ["100"], amountsMin: ["101"] })).status).toBe(400);
    expect((await post({ action: "withdraw", vault: VAULT, wallet: me, shares: "0", minAmountsOut: ["1"] })).status).toBe(400);
  });

  it("is unavailable without a verified Soroban RPC", async () => {
    vi.stubEnv("STELLAR_MAINNET_SOROBAN_RPC_URL", "");
    const res = await post({ action: "deposit", vault: VAULT, wallet: me, amounts: ["100"], amountsMin: ["99"] });
    expect(res.status).toBe(503);
  });

  it("refuses vaults not listed by DeFindex", async () => {
    listed([]);
    expect((await post({ action: "deposit", vault: VAULT, wallet: me, amounts: ["100"], amountsMin: ["99"] })).status).toBe(404);
  });

  it("refuses vectors that don't match the vault's asset count", async () => {
    listed([VAULT]);
    expect((await post({ action: "deposit", vault: VAULT, wallet: me, amounts: ["100", "5"], amountsMin: ["99", "4"] })).status).toBe(400);
  });

  it("builds a deposit that passes the client's guard with identical arguments", async () => {
    listed([VAULT]);
    const res = await post({ action: "deposit", vault: VAULT, wallet: me, amounts: ["1000000000"], amountsMin: ["995000000"] });
    expect(res.status).toBe(200);
    const { xdr } = await res.json();
    const { guardTransaction } = await import("@/lib/stellar/tx-guard");
    const { defindexDepositArgs, defindexIntent } = await import("@/lib/stellar/defindex-requests");
    const intent = defindexIntent(VAULT, "deposit", defindexDepositArgs(me, [1_000_000_000n], [995_000_000n]));
    expect(() => guardTransaction(xdr, { ...intent, source: me })).not.toThrow();
  });

  it("maps a failing simulation to a safe 422 with no provider text", async () => {
    listed([VAULT]); state.simFail = true;
    const res = await post({ action: "withdraw", vault: VAULT, wallet: me, shares: "10", minAmountsOut: ["9"] });
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).not.toMatch(/HostError|Contract, #/);
  });
});

describe("DeFindex position route", () => {
  it("returns assets and amounts for requested shares", async () => {
    listed([VAULT]);
    const { GET } = await import("@/app/api/stellar/defindex/position/route");
    const res = await GET({ nextUrl: new URL(`http://x/?vault=${VAULT}&wallet=${me}&shares=10`), headers: new Headers() } as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.assets).toEqual([{ address: ASSET, symbol: "USDC", decimals: 7 }]);
    expect(body.userShares).toBe("0");
    expect(body.amountsForShares).toEqual(["1"]);
    void Account; void Address; void nativeToScVal;
  });
});
