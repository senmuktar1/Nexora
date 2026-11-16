import { describe, expect, it, vi } from "vitest";
import { Account, Asset, Keypair, Networks, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { PoolContractV2, RequestType } from "@blend-capital/blend-sdk";
import { blendIntent, blendSubmitArgs, toUnits, formatUnits } from "@/lib/stellar/blend-requests";
import { guardTransaction, TxGuardError } from "@/lib/stellar/tx-guard";
import { describeTransaction } from "@/lib/stellar/describe";

vi.mock("server-only", () => ({}));

const POOL = "CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD";
const USDC_SAC = new Asset("USDC", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN").contractId(Networks.PUBLIC);
const me = Keypair.random().publicKey();
const NOW = 1_800_000_000_000;

/** What a (possibly malicious) server could return. */
function serverTx(opts: { type?: number; amount?: bigint; to?: string; asset?: string } = {}) {
  const op = xdr.Operation.fromXDR(String(new PoolContractV2(POOL).submit({
    from: me, spender: me, to: opts.to ?? me,
    requests: [{ request_type: opts.type ?? RequestType.SupplyCollateral, address: opts.asset ?? USDC_SAC, amount: opts.amount ?? 25_0000000n }]
  })), "base64");
  return new TransactionBuilder(new Account(me, "10"), { fee: "150000", networkPassphrase: Networks.PUBLIC, timebounds: { minTime: 0, maxTime: NOW / 1000 + 170 } })
    .addOperation(op as never).build().toEnvelope().toXDR("base64");
}
const reason = (fn: () => unknown) => { try { fn(); return "ok"; } catch (e) { return e instanceof TxGuardError ? e.reason : String(e); } };

describe("Blend requests", () => {
  it("parses amounts with the reserve's decimals", () => {
    expect(toUnits("25", 7)).toBe(250_000_000n);
    expect(toUnits("0.1234567", 7)).toBe(1_234_567n);
    expect(toUnits("0.12345678", 7)).toBeNull();
    expect(formatUnits(250_000_000n, 7)).toBe("25");
  });

  it("guard accepts the server tx only when its call arguments match the client's", () => {
    const intent = blendIntent(POOL, blendSubmitArgs(POOL, me, "supply", USDC_SAC, 25_0000000n));
    expect(reason(() => guardTransaction(serverTx(), { ...intent, source: me }, NOW))).toBe("ok");
    expect(reason(() => guardTransaction(serverTx({ amount: 26_0000000n }), { ...intent, source: me }, NOW))).toBe("op_0_args_mismatch");
    expect(reason(() => guardTransaction(serverTx({ type: RequestType.Borrow }), { ...intent, source: me }, NOW))).toBe("op_0_args_mismatch");
    expect(reason(() => guardTransaction(serverTx({ to: Keypair.random().publicKey() }), { ...intent, source: me }, NOW))).toBe("op_0_args_mismatch");
    const otherAsset = Asset.native().contractId(Networks.PUBLIC);
    expect(reason(() => guardTransaction(serverTx({ asset: otherAsset }), { ...intent, source: me }, NOW))).toBe("op_0_args_mismatch");
  });

  it("approval sheet decodes the pool request with derived SAC decimals", () => {
    const tx = guardTransaction(serverTx(), { ...blendIntent(POOL, blendSubmitArgs(POOL, me, "supply", USDC_SAC, 25_0000000n)), source: me }, NOW);
    const op = describeTransaction(tx).operations[0];
    expect(op.title).toBe("Lending pool request");
    expect(op.rows).toContainEqual(["Supply as collateral", "25 USDC"]);
    expect(op.rows).toContainEqual(["To", "Same account"]);
  });

  it("rejects invalid requests", () => {
    expect(() => blendSubmitArgs(POOL, me, "supply", USDC_SAC, 0n)).toThrow();
    expect(() => blendSubmitArgs("CBAD", me, "supply", USDC_SAC, 1n)).toThrow();
  });
});

describe("Blend build route", () => {
  it("validates input and refuses without a verified Soroban RPC", async () => {
    vi.stubEnv("STELLAR_MAINNET_SOROBAN_RPC_URL", "");
    const { POST } = await import("@/app/api/stellar/blend/build/route");
    const req = (body: unknown) => new Request("http://x/api/stellar/blend/build", { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": Math.random().toString() } }) as never;
    expect((await POST(req({ action: "steal", poolId: POOL, asset: USDC_SAC, wallet: me, units: "1" }))).status).toBe(400);
    expect((await POST(req({ action: "supply", poolId: POOL, asset: USDC_SAC, wallet: me, units: "-5" }))).status).toBe(400);
    const res = await POST(req({ action: "supply", poolId: POOL, asset: USDC_SAC, wallet: me, units: "250000000" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "Temporarily unavailable.", status: "soroban_unavailable" });
  });
});
