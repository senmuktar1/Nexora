import { describe, expect, it, beforeEach } from "vitest";
import { Account, Asset, Claimant, Contract, nativeToScVal, Keypair, Memo, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { guardTransaction, NEXORA_NETWORK_PASSPHRASE, TxGuardError, type SignIntent } from "@/lib/stellar/tx-guard";
import * as session from "@/lib/wallet/session";

const USDC = new Asset("USDC", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
const USDC_ID = `USDC:${USDC.getIssuer()}`;
const FAKE_USDC = new Asset("USDC", Keypair.random().publicKey());
const NOW = 1_800_000_000_000;

function build(source: string, ops: ReturnType<typeof Operation.payment>[], opts: { fee?: string; timeout?: number; passphrase?: string; memo?: Memo } = {}) {
  const b = new TransactionBuilder(new Account(source, "100"), {
    fee: opts.fee ?? "100",
    networkPassphrase: opts.passphrase ?? Networks.PUBLIC,
    timebounds: { minTime: 0, maxTime: Math.floor(NOW / 1000) + (opts.timeout ?? 120) },
    memo: opts.memo
  });
  ops.forEach(op => b.addOperation(op));
  return b.build().toEnvelope().toXDR("base64");
}

describe("tx guard", () => {
  const me = Keypair.random().publicKey();
  const dest = Keypair.random().publicKey();
  const intent: SignIntent = {
    networkPassphrase: NEXORA_NETWORK_PASSPHRASE,
    source: me,
    maxFeeStroops: 1000,
    operations: [{ type: "payment", destination: dest, asset: USDC_ID, amount: "10" }]
  };

  const reason = (fn: () => unknown) => { try { fn(); return "passed"; } catch (e) { return e instanceof TxGuardError ? e.reason : "other"; } };

  it("accepts a transaction matching the intent", () => {
    const xdr = build(me, [Operation.payment({ destination: dest, asset: USDC, amount: "10.0000000" })]);
    expect(reason(() => guardTransaction(xdr, intent, NOW))).toBe("passed");
  });

  it("rejects a different destination", () => {
    const xdr = build(me, [Operation.payment({ destination: Keypair.random().publicKey(), asset: USDC, amount: "10" })]);
    expect(reason(() => guardTransaction(xdr, intent, NOW))).toBe("op_0_destination_mismatch");
  });

  it("rejects a same-ticker asset from a different issuer", () => {
    const xdr = build(me, [Operation.payment({ destination: dest, asset: FAKE_USDC, amount: "10" })]);
    expect(reason(() => guardTransaction(xdr, intent, NOW))).toBe("op_0_asset_mismatch");
  });

  it("rejects a changed amount", () => {
    const xdr = build(me, [Operation.payment({ destination: dest, asset: USDC, amount: "10.0000001" })]);
    expect(reason(() => guardTransaction(xdr, intent, NOW))).toBe("op_0_amount_mismatch");
  });

  it("rejects an injected extra operation", () => {
    const xdr = build(me, [
      Operation.payment({ destination: dest, asset: USDC, amount: "10" }),
      Operation.payment({ destination: dest, asset: Asset.native(), amount: "500" })
    ]);
    expect(reason(() => guardTransaction(xdr, intent, NOW))).toBe("operation_count_mismatch");
  });

  it("rejects an operation sourced from another account", () => {
    const xdr = build(me, [Operation.payment({ destination: dest, asset: USDC, amount: "10", source: Keypair.random().publicKey() })]);
    expect(reason(() => guardTransaction(xdr, intent, NOW))).toBe("op_0_source_mismatch");
  });

  it("rejects the wrong transaction source", () => {
    const xdr = build(Keypair.random().publicKey(), [Operation.payment({ destination: dest, asset: USDC, amount: "10" })]);
    expect(reason(() => guardTransaction(xdr, intent, NOW))).toBe("source_mismatch");
  });

  it("refuses non-Mainnet intents", () => {
    const xdr = build(me, [Operation.payment({ destination: dest, asset: USDC, amount: "10" })], { passphrase: Networks.TESTNET });
    expect(reason(() => guardTransaction(xdr, { ...intent, networkPassphrase: Networks.TESTNET }, NOW))).toBe("wrong_network");
  });

  it("rejects excessive fees and long validity", () => {
    const pay = Operation.payment({ destination: dest, asset: USDC, amount: "10" });
    expect(reason(() => guardTransaction(build(me, [pay], { fee: "5000" }), intent, NOW))).toBe("fee_too_high");
    expect(reason(() => guardTransaction(build(me, [pay], { timeout: 3600 }), intent, NOW))).toBe("validity_too_long");
    expect(reason(() => guardTransaction(build(me, [pay]), intent, NOW + 10 * 60_000))).toBe("expired");
  });

  it("rejects unexpected memos", () => {
    const xdr = build(me, [Operation.payment({ destination: dest, asset: USDC, amount: "10" })], { memo: Memo.text("hi") });
    expect(reason(() => guardTransaction(xdr, intent, NOW))).toBe("memo_mismatch");
    expect(reason(() => guardTransaction(xdr, { ...intent, memo: { type: "text", value: "hi" } }, NOW))).toBe("passed");
  });

  it("rejects garbage XDR", () => {
    expect(reason(() => guardTransaction("not-xdr", intent, NOW))).toBe("invalid_xdr");
  });

  it("enforces path-payment slippage floor", () => {
    const op = Operation.pathPaymentStrictSend({ sendAsset: Asset.native(), sendAmount: "100", destination: me, destAsset: USDC, destMin: "9", path: [] });
    const xdr = build(me, [op]);
    const swapIntent: SignIntent = { ...intent, operations: [{ type: "pathPaymentStrictSend", sendAsset: "native", sendAmount: "100", destination: me, destAsset: USDC_ID, destMin: "9.5" }] };
    expect(reason(() => guardTransaction(xdr, swapIntent, NOW))).toBe("op_0_min_received_lowered");
  });

  it("checks claimable-balance claimants", () => {
    const op = Operation.createClaimableBalance({ asset: USDC, amount: "5", claimants: [new Claimant(dest), new Claimant(me)] });
    const xdr = build(me, [op as never]);
    const u = { type: "unconditional" as const };
    const v: SignIntent = { ...intent, operations: [{ type: "createClaimableBalance", asset: USDC_ID, amount: "5", claimants: [{ destination: me, predicate: u }, { destination: dest, predicate: u }] }] };
    expect(reason(() => guardTransaction(xdr, v, NOW))).toBe("passed");
    expect(reason(() => guardTransaction(xdr, { ...v, operations: [{ type: "createClaimableBalance", asset: USDC_ID, amount: "5", claimants: [{ destination: me, predicate: u }] }] }, NOW))).toBe("op_0_claimants_mismatch");
    expect(reason(() => guardTransaction(xdr, { ...v, operations: [{ type: "createClaimableBalance", asset: USDC_ID, amount: "5", claimants: [{ destination: me, predicate: u }, { destination: dest, predicate: { type: "beforeAbsolute", epoch: 1 } }] }] }, NOW))).toBe("op_0_predicate_mismatch");
  });

  it("requires the exact operation source", () => {
    const other = Keypair.random().publicKey();
    const xdr = build(me, [Operation.payment({ destination: dest, asset: USDC, amount: "10" })]);
    // Expecting the op to come from `other` must fail when it actually comes from the tx source.
    expect(reason(() => guardTransaction(xdr, { ...intent, operations: [{ ...intent.operations[0], source: other }] }, NOW))).toBe("op_0_source_mismatch");
    const xdr2 = build(me, [Operation.payment({ destination: dest, asset: USDC, amount: "10", source: other })]);
    expect(reason(() => guardTransaction(xdr2, { ...intent, operations: [{ ...intent.operations[0], source: other }] }, NOW))).toBe("passed");
  });

  it("checks Soroban contract and function identity", () => {
    const c = new Contract("CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD");
    const xdr = build(me, [c.call("submit", nativeToScVal(1)) as never]);
    const ok: SignIntent = { ...intent, operations: [{ type: "invokeContract", contractId: c.contractId(), functionName: "submit" }] };
    expect(reason(() => guardTransaction(xdr, ok, NOW))).toBe("passed");
    expect(reason(() => guardTransaction(xdr, { ...ok, operations: [{ type: "invokeContract", contractId: c.contractId(), functionName: "withdraw" }] }, NOW))).toBe("op_0_function_mismatch");
    expect(reason(() => guardTransaction(xdr, { ...ok, operations: [{ type: "invokeContract", contractId: "CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS", functionName: "submit" }] }, NOW))).toBe("op_0_contract_mismatch");
  });

  it("refuses setOptions that touch signers", () => {
    const xdr = build(me, [Operation.setOptions({ signer: { ed25519PublicKey: dest, weight: 1 } }) as never]);
    expect(reason(() => guardTransaction(xdr, { ...intent, operations: [{ type: "setOptions" }] }, NOW))).toBe("op_0_unsafe_set_options");
  });
});

describe("signWithIntent (local signing, no broadcast)", () => {
  beforeEach(async () => {
    session.__setKdfIterationsForTests(100_000);
    await session.deleteLocalWallet();
  });

  it("signs a verified transaction with the local key and refuses a tampered one", async () => {
    const kp = Keypair.random();
    await session.saveWallet(kp.secret(), "correct horse battery");
    const dest = Keypair.random().publicKey();
    const now = Date.now();
    const tx = new TransactionBuilder(new Account(kp.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.PUBLIC, timebounds: { minTime: 0, maxTime: Math.floor(now / 1000) + 60 } })
      .addOperation(Operation.payment({ destination: dest, asset: Asset.native(), amount: "1" })).build();
    const intent = { networkPassphrase: Networks.PUBLIC, maxFeeStroops: 100, operations: [{ type: "payment" as const, destination: dest, asset: "native", amount: "1" }] };

    const signed = session.signWithIntent(tx.toEnvelope().toXDR("base64"), intent);
    const parsed = TransactionBuilder.fromXDR(signed, Networks.PUBLIC);
    expect(parsed.signatures).toHaveLength(1);
    expect(kp.verify(parsed.hash(), Buffer.from((parsed.signatures[0].signature as unknown as { value: Uint8Array }).value))).toBe(true);

    expect(() => session.signWithIntent(tx.toEnvelope().toXDR("base64"), { ...intent, operations: [{ ...intent.operations[0], amount: "2" }] })).toThrow(TxGuardError);
  });
});
