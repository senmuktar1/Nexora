import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { Account, Address, Keypair, Networks, nativeToScVal, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

vi.mock("server-only", () => ({}));
const state = { simFail: false, installed: false };
vi.mock("@stellar/stellar-sdk", async (orig) => {
  const actual = await orig<typeof import("@stellar/stellar-sdk")>();
  class FakeServer {
    async getNetwork() { return { passphrase: actual.Networks.PUBLIC }; }
    async getHealth() { return { status: "healthy", latestLedger: 1 }; }
    async simulateTransaction() { return state.simFail ? { error: "HostError: Error(WasmVm, InvalidAction)" } : { result: { retval: actual.nativeToScVal(null) } }; }
    async getLedgerEntries() { return { entries: state.installed ? [{}] : [] }; }
  }
  return { ...actual, rpc: { ...actual.rpc, Server: FakeServer, Api: { ...actual.rpc.Api, isSimulationSuccess: (s: { error?: unknown }) => !s.error }, assembleTransaction: (tx: unknown) => ({ build: () => tx }) } };
});

const { buildDeployTx, buildUploadTx } = await import("@/lib/stellar/soroban-token");
const { guardTransaction } = await import("@/lib/stellar/tx-guard");
const wasm = readFileSync("public/contracts/nexora-token.wasm");
const me = Keypair.random();
const src = { id: me.publicKey(), sequence: "5" };
const params = { name: "Nexo", symbol: "NEXO", decimals: 7, recipient: me.publicKey(), supplyUnits: 10n };

const post = async (xdr: string) => {
  const { POST } = await import("@/app/api/stellar/soroban/prepare/route");
  return POST(new Request("http://x", { method: "POST", body: JSON.stringify({ xdr }), headers: { "x-forwarded-for": Math.random().toString() } }) as never);
};
const raw = (op: ReturnType<typeof Operation.uploadContractWasm>, source = me.publicKey()) =>
  new TransactionBuilder(new Account(source, "5"), { fee: "100", networkPassphrase: Networks.PUBLIC, timebounds: { minTime: 0, maxTime: 2_000_000_000 } }).addOperation(op);

beforeEach(() => { vi.stubEnv("STELLAR_MAINNET_SOROBAN_RPC_URL", "https://rpc.example.com"); state.simFail = false; state.installed = false; vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("soroban prepare route", () => {
  it("prepares the pinned upload and a deploy by the tx source; output passes the client guard", async () => {
    const up = buildUploadTx(src, wasm);
    const r1 = await post(up.xdr);
    expect(r1.status).toBe(200);
    const x1 = (await r1.json()).xdr;
    expect(() => guardTransaction(x1, { ...up.intent, source: me.publicKey() })).not.toThrow();
    const dep = buildDeployTx(src, params, randomBytes(32));
    const r2 = await post(dep.xdr);
    expect(r2.status).toBe(200);
    const x2 = (await r2.json()).xdr;
    expect(() => guardTransaction(x2, { ...dep.intent, source: me.publicKey() })).not.toThrow();
  });

  it("refuses other code, foreign deployers, signed or multi-op envelopes", async () => {
    expect((await post(raw(Operation.uploadContractWasm({ wasm: Buffer.from("not the token") })).build().toEnvelope().toXDR("base64"))).status).toBe(400);
    const foreign = raw(Operation.createCustomContract({ address: new Address(Keypair.random().publicKey()), wasmHash: Buffer.from("80d27ccd6861a5045369c83d101eb964ae2a709f4443e5f75cf96726c5038878", "hex"), salt: randomBytes(32), constructorArgs: [nativeToScVal(1)] }) as never).build();
    expect((await post(foreign.toEnvelope().toXDR("base64"))).status).toBe(400);
    const signed = raw(Operation.uploadContractWasm({ wasm })).build(); signed.sign(me);
    expect((await post(signed.toEnvelope().toXDR("base64"))).status).toBe(400);
    const multi = raw(Operation.uploadContractWasm({ wasm })).addOperation(Operation.uploadContractWasm({ wasm })).build();
    expect((await post(multi.toEnvelope().toXDR("base64"))).status).toBe(400);
  });

  it("safe 422 on simulation failure; 503 without a verified RPC", async () => {
    state.simFail = true;
    const r = await post(buildUploadTx(src, wasm).xdr);
    expect(r.status).toBe(422);
    expect(JSON.stringify(await r.json())).not.toMatch(/HostError|WasmVm/);
    vi.stubEnv("STELLAR_MAINNET_SOROBAN_RPC_URL", "");
    vi.resetModules();
    const { POST } = await import("@/app/api/stellar/soroban/prepare/route");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ xdr: buildUploadTx(src, wasm).xdr }), headers: { "x-forwarded-for": "9.9.9.9" } }) as never);
    expect(res.status).toBe(503);
  });

  it("code-status reports whether the token code is installed", async () => {
    const { GET } = await import("@/app/api/stellar/soroban/code-status/route");
    expect(await (await GET()).json()).toMatchObject({ installed: false });
    state.installed = true;
    expect(await (await GET()).json()).toMatchObject({ installed: true });
  });
});
