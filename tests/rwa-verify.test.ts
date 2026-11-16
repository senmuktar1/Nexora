import { describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

vi.mock("server-only", () => ({}));

/**
 * Exact-shape verification of RWA Stellar transactions (Horizon records). Each step is
 * checked independently; anything beyond the one acceptable shape is refused.
 */
const { checkIssuanceOps, checkTrustlineAuthorizationOps, checkDeliveryOps } = await import("@/lib/server/rwa");

const D = Keypair.random().publicKey();      // issuer's wallet = distribution account
const I = Keypair.random().publicKey();      // token issuer created by the issuance
const INV = Keypair.random().publicKey();    // investor
const OTHER = Keypair.random().publicKey();
const cfg = { distributor_address: D, token_code: "HTWR", total_supply: "1000000.0000000", clawback_enabled: true };
type Op = Record<string, unknown>;

const issuanceOps = (): Op[] => [
  { type: "create_account", source_account: D, funder: D, account: I, starting_balance: "1.5000000" },
  { type: "set_options", source_account: I, set_flags: [1, 2, 8], set_flags_s: ["auth_required_flag", "auth_revocable_flag", "auth_clawback_enabled_flag"] },
  { type: "change_trust", source_account: D, trustor: D, asset_type: "credit_alphanum4", asset_code: "HTWR", asset_issuer: I, limit: "922337203685.4775807" },
  { type: "set_trust_line_flags", source_account: I, trustor: D, asset_type: "credit_alphanum4", asset_code: "HTWR", asset_issuer: I, set_flags: [1] },
  { type: "payment", source_account: I, from: I, to: D, asset_type: "credit_alphanum4", asset_code: "HTWR", asset_issuer: I, amount: "1000000.0000000" }
];
const tx = (ops: Op[], source = D) => ({ successful: true, source_account: source, operation_count: ops.length });
const issue = (ops: Op[], over: Record<string, unknown> = {}, source = D) => () => checkIssuanceOps(tx(ops, source), ops, { ...cfg, ...over });
const edit = (i: number, patch: Op) => { const ops = issuanceOps(); ops[i] = { ...ops[i], ...patch }; return ops; };

describe("issuance verification", () => {
  it("accepts exactly the authorised issuance", () => {
    expect(checkIssuanceOps(tx(issuanceOps()), issuanceOps(), cfg)).toEqual({ issuer: I });
    const noClawback = edit(1, { set_flags: [1, 2] });
    expect(checkIssuanceOps(tx(noClawback), noClawback, { ...cfg, clawback_enabled: false })).toEqual({ issuer: I });
  });

  it("rejects an additional payment", () => {
    const ops = [...issuanceOps(), { type: "payment", source_account: I, from: I, to: OTHER, asset_code: "HTWR", asset_issuer: I, amount: "5.0000000" }];
    expect(issue(ops)).toThrow(/exactly/);
    const xlm = [...issuanceOps(), { type: "payment", source_account: D, from: D, to: OTHER, asset_type: "native", amount: "100.0000000" }];
    expect(issue(xlm)).toThrow(/exactly/);
  });

  it("rejects duplicate account creation", () => {
    const ops = issuanceOps();
    ops.splice(1, 0, { type: "create_account", source_account: D, funder: D, account: OTHER, starting_balance: "1.5000000" });
    expect(issue(ops)).toThrow(/exactly/);
  });

  it("rejects unexpected set_options (extra op, signer, lock, home domain, thresholds, extra/missing/cleared flags)", () => {
    const extra = [...issuanceOps(), { type: "set_options", source_account: I, signer_key: OTHER, signer_weight: 1 }];
    expect(issue(extra)).toThrow(/exactly/);
    expect(issue(edit(1, { master_key_weight: 0 }))).toThrow(/locked/);
    expect(issue(edit(1, { signer_key: OTHER, signer_weight: 10 }))).toThrow(/transfer controls/);
    expect(issue(edit(1, { home_domain: "evil.example" }))).toThrow(/transfer controls/);
    expect(issue(edit(1, { high_threshold: 255 }))).toThrow(/transfer controls/);
    expect(issue(edit(1, { set_flags: [1, 2, 4, 8] }))).toThrow(/transfer controls/);  // AUTH_IMMUTABLE would freeze controls
    expect(issue(edit(1, { set_flags: [1, 2] }))).toThrow(/transfer controls/);        // clawback required by config
    expect(issue(edit(1, { set_flags: [1] }))).toThrow(/transfer controls/);
    expect(issue(edit(1, { clear_flags: [2] }))).toThrow(/transfer controls/);
    expect(issue(edit(1, { source_account: D }))).toThrow(/transfer controls/);
  });

  it("rejects unrelated trustline operations", () => {
    expect(issue(edit(2, { asset_code: "OTHER" }))).toThrow(/trustline/);
    expect(issue(edit(2, { source_account: OTHER, trustor: OTHER }))).toThrow(/trustline/);
    expect(issue(edit(3, { trustor: OTHER }))).toThrow(/authorised as expected/);
    expect(issue(edit(3, { asset_issuer: OTHER }))).toThrow(/authorised as expected/);
    expect(issue(edit(3, { set_flags: [2] }))).toThrow(/authorised as expected/);
    const extraTrust = [...issuanceOps(), { type: "set_trust_line_flags", source_account: I, trustor: OTHER, asset_code: "HTWR", asset_issuer: I, set_flags: [1] }];
    expect(issue(extraTrust)).toThrow(/exactly/);
    const extraChangeTrust = [...issuanceOps(), { type: "change_trust", source_account: D, trustor: D, asset_code: "USDC", asset_issuer: OTHER }];
    expect(issue(extraChangeTrust)).toThrow(/exactly/);
  });

  it("validates sources, destinations, amounts and order", () => {
    expect(issue(issuanceOps(), {}, OTHER)).toThrow(/expected Stellar address/);
    expect(issue(edit(0, { funder: OTHER }))).toThrow(/issuer account/);
    expect(issue(edit(0, { account: D }))).toThrow(/issuer account/);
    expect(issue(edit(0, { starting_balance: "5000.0000000" }))).toThrow(/issuer account/);
    expect(issue(edit(4, { to: OTHER }))).toThrow(/minted/);
    expect(issue(edit(4, { amount: "1000001.0000000" }))).toThrow(/minted/);
    expect(issue(edit(4, { source_account: D, from: D }))).toThrow(/minted/);
    expect(issue(edit(4, { asset_type: "native", asset_code: undefined, asset_issuer: undefined }))).toThrow(/minted/);
    const reordered = issuanceOps(); [reordered[2], reordered[3]] = [reordered[3], reordered[2]];
    expect(issue(reordered)).toThrow(/exactly/);
    expect(issue(issuanceOps().slice(0, 4))).toThrow(/exactly/);
  });

  it("rejects incomplete operation listings and failed operations", () => {
    const ops = issuanceOps();
    expect(() => checkIssuanceOps({ ...tx(ops), operation_count: 6 }, ops, cfg)).toThrow(/completely/);
    expect(issue(edit(4, { transaction_successful: false }))).toThrow(/failed/);
  });
});

describe("strict operation_count", () => {
  const authOp = { type: "set_trust_line_flags", source_account: I, trustor: INV, asset_code: "HTWR", asset_issuer: I, set_flags: [1] };
  const payOp = { type: "payment", source_account: D, from: D, to: INV, asset_code: "HTWR", asset_issuer: I, amount: "500.0000000" };
  const steps = [
    ["issuance", issuanceOps(), (t: Record<string, unknown>, ops: Op[]) => checkIssuanceOps(t, ops, cfg)],
    ["authorisation", [authOp], (t: Record<string, unknown>, ops: Op[]) => checkTrustlineAuthorizationOps(t, ops, { distributor: D, issuer: I, code: "HTWR", investor: INV })],
    ["delivery", [payOp], (t: Record<string, unknown>, ops: Op[]) => checkDeliveryOps(t, ops, { distributor: D, issuer: I, code: "HTWR", investor: INV, amount: "500" })]
  ] as const;
  for (const [name, ops, check] of steps) {
    it(`${name}: rejects a missing operation_count`, () => {
      const { operation_count: _omit, ...noCount } = tx([...ops]); void _omit;
      expect(() => check(noCount, [...ops])).toThrow(/no valid operation count/);
    });
    it(`${name}: rejects invalid operation_count values`, () => {
      for (const bad of [null, "5", String(ops.length), ops.length + 0.5, 0, -1, Number.NaN, Infinity, 101, [ops.length], { n: ops.length }, true]) {
        expect(() => check({ ...tx([...ops]), operation_count: bad }, [...ops]), String(bad)).toThrow(/no valid operation count/);
      }
    });
    it(`${name}: rejects an operation_count inconsistent with the returned operations`, () => {
      expect(() => check({ ...tx([...ops]), operation_count: ops.length + 1 }, [...ops])).toThrow(/couldn't be read completely/);
      if (ops.length > 1) expect(() => check({ ...tx([...ops]), operation_count: ops.length - 1 }, [...ops])).toThrow(/couldn't be read completely/);
    });
    it(`${name}: accepts the exact count`, () => { expect(() => check(tx([...ops]), [...ops])).not.toThrow(); });
  }
});

describe("trustline authorisation verification", () => {
  const expected = { distributor: D, issuer: I, code: "HTWR", investor: INV };
  const op = (patch: Op = {}): Op => ({ type: "set_trust_line_flags", source_account: I, trustor: INV, asset_code: "HTWR", asset_issuer: I, set_flags: [1], ...patch });
  const check = (ops: Op[], source = D) => () => checkTrustlineAuthorizationOps(tx(ops, source), ops, expected);
  it("accepts exactly one authorisation of this investor", () => { expect(check([op()])).not.toThrow(); });
  it("rejects additional payments or operations", () => {
    expect(check([op(), { type: "payment", source_account: D, from: D, to: INV, asset_code: "HTWR", asset_issuer: I, amount: "1.0000000" }])).toThrow(/exactly/);
    expect(check([op(), op({ trustor: OTHER })])).toThrow(/exactly/);
    expect(check([{ type: "create_account", source_account: D, funder: D, account: OTHER, starting_balance: "1" }, op()])).toThrow(/exactly/);
    expect(check([op(), { type: "set_options", source_account: I, master_key_weight: 0 }])).toThrow(/exactly/);
  });
  it("rejects unrelated trustline operations", () => {
    expect(check([op({ trustor: OTHER })])).toThrow(/didn't authorise/);
    expect(check([op({ asset_code: "OTHER" })])).toThrow(/didn't authorise/);
    expect(check([op({ asset_issuer: OTHER })])).toThrow(/didn't authorise/);
    expect(check([op({ source_account: OTHER })])).toThrow(/didn't authorise/);
    expect(check([op({ set_flags: [2] })])).toThrow(/didn't authorise/);
    expect(check([op({ clear_flags: [1] })])).toThrow(/didn't authorise/);
    expect(check([{ type: "change_trust", source_account: INV, trustor: INV, asset_code: "HTWR", asset_issuer: I }])).toThrow(/exactly/);
  });
  it("must be sent by the distribution wallet", () => { expect(check([op()], OTHER)).toThrow(/expected Stellar address/); });
});

describe("delivery verification", () => {
  const expected = { distributor: D, issuer: I, code: "HTWR", investor: INV, amount: "500" };
  const pay = (patch: Op = {}): Op => ({ type: "payment", source_account: D, from: D, to: INV, asset_code: "HTWR", asset_issuer: I, amount: "500.0000000", ...patch });
  const check = (ops: Op[], source = D) => () => checkDeliveryOps(tx(ops, source), ops, expected);
  it("accepts exactly one payment of the subscribed amount", () => { expect(check([pay()])).not.toThrow(); });
  it("rejects additional payments and duplicate account creation", () => {
    expect(check([pay(), pay({ to: OTHER })])).toThrow(/exactly/);
    expect(check([pay(), pay()])).toThrow(/exactly/);
    expect(check([{ type: "create_account", source_account: D, funder: D, account: INV, starting_balance: "1" }, pay()])).toThrow(/exactly/);
  });
  it("rejects unexpected set_options and unrelated trustline operations", () => {
    expect(check([pay(), { type: "set_options", source_account: D, signer_key: OTHER, signer_weight: 1 }])).toThrow(/exactly/);
    expect(check([pay(), { type: "set_trust_line_flags", source_account: I, trustor: OTHER, asset_code: "HTWR", asset_issuer: I, set_flags: [1] }])).toThrow(/exactly/);
  });
  it("validates source, destination, asset and amount", () => {
    expect(check([pay({ to: OTHER })])).toThrow(/didn't deliver/);
    expect(check([pay({ amount: "499.9999999" })])).toThrow(/didn't deliver/);
    expect(check([pay({ asset_issuer: OTHER })])).toThrow(/didn't deliver/);
    expect(check([pay({ source_account: I, from: I })])).toThrow(/didn't deliver/);
    expect(check([pay({ asset_type: "native", asset_code: undefined, asset_issuer: undefined })])).toThrow(/didn't deliver/);
    expect(check([pay()], OTHER)).toThrow(/expected Stellar address/);
  });
  it("can't be satisfied by an issuance or authorisation transaction", () => {
    const auth = [{ type: "set_trust_line_flags", source_account: I, trustor: INV, asset_code: "HTWR", asset_issuer: I, set_flags: [1] }];
    expect(check(auth)).toThrow(/exactly/);
    expect(() => checkTrustlineAuthorizationOps(tx([pay()]), [pay()], expected)).toThrow(/exactly/);
    expect(() => checkIssuanceOps(tx([pay()]), [pay()], cfg)).toThrow(/exactly/);
  });
});
