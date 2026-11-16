import { describe, expect, it } from "vitest";
import { Account, Contract, Keypair, Networks, scValToNative, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { defindexDepositArgs, defindexIntent, defindexWithdrawArgs, scValsFromBase64, withSlippage } from "@/lib/stellar/defindex-requests";
import { guardTransaction, TxGuardError } from "@/lib/stellar/tx-guard";
import { describeTransaction } from "@/lib/stellar/describe";

const VAULT = "CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS";
const me = Keypair.random().publicKey();
const NOW = 1_800_000_000_000;
const reason = (fn: () => unknown) => { try { fn(); return "ok"; } catch (e) { return e instanceof TxGuardError ? e.reason : String((e as Error).message); } };

function serverTx(fn: string, args: string[]) {
  const op = new Contract(VAULT).call(fn, ...scValsFromBase64(args));
  return new TransactionBuilder(new Account(me, "3"), { fee: "200000", networkPassphrase: Networks.PUBLIC, timebounds: { minTime: 0, maxTime: NOW / 1000 + 170 } })
    .addOperation(op).build().toEnvelope().toXDR("base64");
}

describe("DeFindex vault calls", () => {
  it("encodes deposit(amounts_desired, amounts_min, from, invest) in contract order", () => {
    const args = defindexDepositArgs(me, [100_0000000n], withSlippage([100_0000000n], 50));
    const native = scValsFromBase64(args).map(v => scValToNative(v));
    expect(native[0]).toEqual([100_0000000n]);
    expect(native[1]).toEqual([99_5000000n]);
    expect(native[2]).toBe(me);
    expect(native[3]).toBe(true);
  });

  it("encodes withdraw(withdraw_shares, min_amounts_out, from)", () => {
    const args = defindexWithdrawArgs(me, 5_000n, [4_975n, 10n]);
    const native = scValsFromBase64(args).map(v => scValToNative(v));
    expect(native).toEqual([5_000n, [4_975n, 10n], me]);
  });

  it("never allows zero/unbounded slippage or invalid amounts", () => {
    expect(() => withSlippage([1n], 0)).toThrow("invalid_slippage");
    expect(() => withSlippage([1n], 501)).toThrow("invalid_slippage");
    expect(() => defindexDepositArgs(me, [0n], [0n])).toThrow("invalid_amounts");
    expect(() => defindexDepositArgs(me, [10n], [11n])).toThrow("invalid_amounts");
    expect(() => defindexDepositArgs(me, [10n, 5n], [9n])).toThrow("invalid_amounts");
    expect(() => defindexWithdrawArgs(me, 0n, [1n])).toThrow("invalid_amounts");
  });

  it("guard refuses a server-built call whose arguments differ", () => {
    const mine = defindexDepositArgs(me, [100n], [99n]);
    const intent = { ...defindexIntent(VAULT, "deposit", mine), source: me };
    expect(reason(() => guardTransaction(serverTx("deposit", mine), intent, NOW))).toBe("ok");
    expect(reason(() => guardTransaction(serverTx("deposit", defindexDepositArgs(me, [100n], [0n])), intent, NOW))).toBe("op_0_args_mismatch");
    expect(reason(() => guardTransaction(serverTx("deposit", defindexDepositArgs(Keypair.random().publicKey(), [100n], [99n])), intent, NOW))).toBe("op_0_args_mismatch");
    expect(reason(() => guardTransaction(serverTx("withdraw", defindexWithdrawArgs(me, 100n, [99n])), intent, NOW))).toBe("op_0_function_mismatch");
  });

  it("approval sheet decodes vault calls", () => {
    const args = defindexWithdrawArgs(me, 5_000n, [4_975n]);
    const tx = guardTransaction(serverTx("withdraw", args), { ...defindexIntent(VAULT, "withdraw", args), source: me }, NOW);
    const op = describeTransaction(tx).operations[0];
    expect(op.title).toBe("Vault withdrawal");
    expect(op.rows).toContainEqual(["Shares", "5000"]);
    void xdr;
  });
});
