import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { buildPayment, PaymentError } from "@/lib/stellar/payment";
import { guardTransaction } from "@/lib/stellar/tx-guard";
import type { AccountState } from "@/lib/stellar/swap";

const me = Keypair.random().publicKey(), them = Keypair.random().publicKey();
const USDC = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const acct = (id: string, extra: AccountState["balances"] = []): AccountState => ({ id, sequence: "9", subentryCount: 0, numSponsoring: 0, numSponsored: 0, balances: [{ asset_type: "native", balance: "50" }, ...extra] });
const err = (fn: () => unknown) => { try { fn(); return "ok"; } catch (e) { return e instanceof PaymentError ? e.code : String(e); } };
const NOW = 1_800_000_000_000;

describe("buildPayment", () => {
  it("pays an existing account with a memo, passing the guard", () => {
    const p = buildPayment({ sender: acct(me), recipient: acct(them), recipientId: them, asset: "native", amount: "2.5", memo: "invoice 42", feePerOperation: 100, now: NOW });
    const tx = guardTransaction(p.xdr, { ...p.intent, source: me }, NOW);
    expect(tx.operations[0].type).toBe("payment");
  });
  it("activates a new account with createAccount (XLM, ≥1)", () => {
    const p = buildPayment({ sender: acct(me), recipient: null, recipientId: them, asset: "native", amount: "2", feePerOperation: 100, now: NOW });
    expect(guardTransaction(p.xdr, { ...p.intent, source: me }, NOW).operations[0].type).toBe("createAccount");
    expect(err(() => buildPayment({ sender: acct(me), recipient: null, recipientId: them, asset: "native", amount: "0.5", feePerOperation: 100 }))).toBe("min_create");
    expect(err(() => buildPayment({ sender: acct(me), recipient: null, recipientId: them, asset: USDC, amount: "5", feePerOperation: 100 }))).toBe("inactive_needs_xlm");
  });
  it("validates balance, trustline, self-payment and memo length", () => {
    expect(err(() => buildPayment({ sender: acct(me), recipient: acct(them), recipientId: them, asset: "native", amount: "49.5", feePerOperation: 100 }))).toBe("insufficient_balance");
    expect(err(() => buildPayment({ sender: acct(me), recipient: acct(them), recipientId: them, asset: USDC, amount: "1", feePerOperation: 100 }))).toBe("no_trustline");
    expect(err(() => buildPayment({ sender: acct(me), recipient: acct(me), recipientId: me, asset: "native", amount: "1", feePerOperation: 100 }))).toBe("self");
    expect(err(() => buildPayment({ sender: acct(me), recipient: acct(them), recipientId: them, asset: "native", amount: "1", memo: "x".repeat(29), feePerOperation: 100 }))).toBe("memo_too_long");
  });
});
