import { describe, expect, it } from "vitest";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { buildSwap, fromStroops, minimumBalanceStroops, spendableStroops, SwapError, type AccountState } from "@/lib/stellar/swap";
import { guardTransaction, TxGuardError } from "@/lib/stellar/tx-guard";
import { describeResultCodes } from "@/lib/stellar/submit-errors";

const USDC = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const me = Keypair.random().publicKey();
const NOW = 1_800_000_000_000;

function account(over: Partial<AccountState> = {}): AccountState {
  return {
    id: me, sequence: "1000", subentryCount: 1, numSponsoring: 0, numSponsored: 0,
    balances: [{ asset_type: "native", balance: "100.0000000", selling_liabilities: "10.0000000" }],
    ...over
  };
}

describe("balances and reserves", () => {
  it("computes minimum balance and spendable XLM", () => {
    expect(fromStroops(minimumBalanceStroops(account()))).toBe("1.5");
    // 100 - 10 liabilities - 1.5 reserve
    expect(fromStroops(spendableStroops(account(), "native"))).toBe("88.5");
    // adding a trustline raises the reserve by 0.5
    expect(fromStroops(spendableStroops(account(), "native", 1))).toBe("88");
    expect(spendableStroops(account(), USDC)).toBe(0n);
  });
});

describe("buildSwap", () => {
  const base = { sendAsset: "native", sendAmount: "10", destAsset: USDC, quotedDestAmount: "2.5", path: [], slippageBps: 50, feePerOperation: 100, now: NOW };

  it("builds a guarded strict-send swap with trustline when missing", () => {
    const plan = buildSwap({ ...base, account: account() });
    expect(plan.review).toMatchObject({ send: "10", expected: "2.5", minimumReceived: "2.4875", addsTrustline: true, networkFee: "0.00002" });
    const tx = guardTransaction(plan.xdr, { ...plan.intent, source: me }, NOW);
    expect(tx.operations.map(o => o.type)).toEqual(["changeTrust", "pathPaymentStrictSend"]);
    expect(tx.sequence).toBe("1001");
  });

  it("skips the trustline when it already exists", () => {
    const plan = buildSwap({ ...base, account: account({ balances: [...account().balances, { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: USDC.split(":")[1], balance: "0" }] }) });
    expect(plan.review.addsTrustline).toBe(false);
    expect(plan.intent.operations).toHaveLength(1);
  });

  it("refuses to spend more than is available", () => {
    expect(() => buildSwap({ ...base, sendAmount: "89", account: account() })).toThrow(SwapError);
  });

  it("validates slippage and amounts", () => {
    expect(() => buildSwap({ ...base, slippageBps: 0, account: account() })).toThrow("invalid_slippage");
    expect(() => buildSwap({ ...base, sendAmount: "-1", account: account() })).toThrow("invalid_amount");
    expect(() => buildSwap({ ...base, destAsset: "native", account: account() })).toThrow("same_asset");
  });

  it("a tampered minimum received is caught by the guard", () => {
    const plan = buildSwap({ ...base, account: account() });
    const loose = buildSwap({ ...base, slippageBps: 1000, account: account() });
    expect(() => guardTransaction(loose.xdr, { ...plan.intent, source: me }, NOW)).toThrow(TxGuardError);
  });

  it("produces Mainnet transactions only", () => {
    const plan = buildSwap({ ...base, account: account() });
    expect(() => TransactionBuilder.fromXDR(plan.xdr, Networks.PUBLIC)).not.toThrow();
  });
});

describe("submit result mapping", () => {
  it("maps Horizon codes to actionable messages", () => {
    expect(describeResultCodes({ transaction: "tx_failed", operations: ["op_under_dest_min"] }).message).toMatch(/slippage/);
    expect(describeResultCodes({ transaction: "tx_bad_seq" }).message).toMatch(/Review/);
    expect(describeResultCodes(null).message).toMatch(/No funds were moved/);
  });
});
