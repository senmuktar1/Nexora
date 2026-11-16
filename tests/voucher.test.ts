import { describe, expect, it } from "vitest";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { guardTransaction, TxGuardError } from "@/lib/stellar/tx-guard";
import {
  buildCreateVouchers, buildRedeem, buildRefund, decodeVoucherLink, encodeVoucherLink,
  normalisePredicate, predicateHolds, splitEvenly, voucherExpiry, VOUCHER_ASSETS, VoucherError, type ClaimableBalance
} from "@/lib/stellar/voucher";
import type { AccountState } from "@/lib/stellar/swap";

const NOW = 1_800_000_000_000;
const nowSec = NOW / 1000;
const USDC = VOUCHER_ASSETS.usdc.assetId;
const creator = Keypair.random();
const recipient = Keypair.random();

const acct = (id: string, xlm = "100", extra: AccountState["balances"] = []): AccountState => ({
  id, sequence: "500", subentryCount: 0, numSponsoring: 0, numSponsored: 0,
  balances: [{ asset_type: "native", balance: xlm, selling_liabilities: "0" }, ...extra]
});
const usdcLine = (b: string) => ({ asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: USDC.split(":")[1], balance: b, selling_liabilities: "0" });
const code = (e: unknown) => e instanceof VoucherError ? e.code : e instanceof TxGuardError ? e.reason : String(e);
const attempt = (fn: () => unknown) => { try { fn(); return "ok"; } catch (e) { return code(e); } };

function balanceFrom(plan: ReturnType<typeof buildCreateVouchers>, i: number, asset = "native"): ClaimableBalance {
  // Mirrors what Horizon returns for the created balance (normalised).
  return {
    id: plan.cards[i].balanceId, asset, amount: plan.cards[i].amount, sponsor: creator.publicKey(), createdAt: new Date(NOW).toISOString(),
    claimants: [
      { destination: plan.cards[i].publicKey, predicate: normalisePredicate({ abs_before_epoch: String(plan.expiry) }) },
      { destination: creator.publicKey(), predicate: normalisePredicate({ not: { abs_before_epoch: String(plan.expiry) } }) }
    ]
  };
}

describe("voucher create", () => {
  const expiry = nowSec + 7 * 86400;

  it("builds one claimable balance per card with the voucher/refund predicates and passes the guard", () => {
    const plan = buildCreateVouchers({ account: acct(creator.publicKey()), asset: "native", amounts: ["5", "5", "5"], expiry, feePerOperation: 100, now: NOW });
    expect(plan.cards).toHaveLength(3);
    expect(new Set(plan.cards.map(c => c.publicKey)).size).toBe(3);
    expect(plan.total).toBe("15");
    expect(plan.reserveLocked).toBe("1.5");
    const tx = guardTransaction(plan.xdr, { ...plan.intent, source: creator.publicKey() }, NOW);
    expect(plan.cards.map((_, i) => tx.getClaimableBalanceId(i))).toEqual(plan.cards.map(c => c.balanceId));
  });

  it("rejects bad inputs", () => {
    const base = { account: acct(creator.publicKey()), asset: "native", amounts: ["5"], expiry, feePerOperation: 100, now: NOW };
    expect(attempt(() => buildCreateVouchers({ ...base, amounts: ["0"] }))).toBe("invalid_amount");
    expect(attempt(() => buildCreateVouchers({ ...base, amounts: Array(51).fill("1") }))).toBe("too_many_cards");
    expect(attempt(() => buildCreateVouchers({ ...base, expiry: nowSec + 60 }))).toBe("invalid_expiry");
    expect(attempt(() => buildCreateVouchers({ ...base, asset: "USDC:" + Keypair.random().publicKey() }))).toBe("unsupported_asset");
    expect(attempt(() => buildCreateVouchers({ ...base, amounts: ["98.6"] }))).toBe("insufficient_balance"); // 100 − 1 reserve − 0.5 balance reserve
    expect(attempt(() => buildCreateVouchers({ ...base, asset: USDC }))).toBe("insufficient_balance"); // no trustline
    expect(attempt(() => buildCreateVouchers({ ...base, feePerOperation: 1_000_000 }))).toBe("invalid_fee");
  });

  it("a tampered predicate is refused by the guard", () => {
    const plan = buildCreateVouchers({ account: acct(creator.publicKey()), asset: "native", amounts: ["5"], expiry, feePerOperation: 100, now: NOW });
    const other = buildCreateVouchers({ account: acct(creator.publicKey()), asset: "native", amounts: ["5"], expiry: expiry + 1, feePerOperation: 100, now: NOW, generateKey: () => Keypair.fromSecret(plan.cards[0].secret) });
    expect(attempt(() => guardTransaction(other.xdr, { ...plan.intent, source: creator.publicKey() }, NOW))).toBe("op_0_predicate_mismatch");
  });
});

describe("delayed unlock", () => {
  it("encodes and(not(before U), before T) and blocks redemption before U", () => {
    const expiry = nowSec + 7 * 86400, unlockAt = nowSec + 86400;
    const plan = buildCreateVouchers({ account: acct(creator.publicKey()), asset: "native", amounts: ["2"], expiry, unlockAt, feePerOperation: 100, now: NOW });
    guardTransaction(plan.xdr, { ...plan.intent, source: creator.publicKey() }, NOW);
    const balance: ClaimableBalance = { ...balanceFrom(plan, 0), claimants: [
      { destination: plan.cards[0].publicKey, predicate: normalisePredicate({ and: [{ not: { abs_before_epoch: String(unlockAt) } }, { abs_before_epoch: String(expiry) }] }) },
      { destination: creator.publicKey(), predicate: normalisePredicate({ not: { abs_before_epoch: String(expiry) } }) }
    ] };
    expect(voucherExpiry(balance, plan.cards[0].publicKey)).toEqual({ expiry, unlockAt, creator: creator.publicKey() });
    const link = { secret: plan.cards[0].secret, balanceId: plan.cards[0].balanceId };
    expect(attempt(() => buildRedeem({ recipient: acct(recipient.publicKey()), link, balance, feePerOperation: 100, now: NOW }))).toBe("not_unlocked");
    expect(attempt(() => buildRedeem({ recipient: acct(recipient.publicKey()), link, balance, feePerOperation: 100, now: (unlockAt + 1) * 1000 }))).toBe("ok");
    expect(attempt(() => buildCreateVouchers({ account: acct(creator.publicKey()), asset: "native", amounts: ["2"], expiry, unlockAt: expiry, feePerOperation: 100, now: NOW }))).toBe("invalid_expiry");
  });
});

describe("voucher links", () => {
  it("round-trips through the URL fragment", () => {
    const secret = Keypair.random().secret();
    const balanceId = "00000000" + "ab".repeat(32);
    const url = encodeVoucherLink("https://nexora.example", { secret, balanceId });
    expect(url.split("#")[0]).toBe("https://nexora.example/redeem");
    expect(url.split("#")[0]).not.toContain(secret);
    expect(decodeVoucherLink(url)).toEqual({ secret, balanceId });
    expect(attempt(() => decodeVoucherLink(url.replace(/b=.*/, "b=1234")))).toBe("invalid_link");
    expect(attempt(() => decodeVoucherLink("k=SNOPE&b=" + balanceId))).toBe("invalid_link");
  });
});

describe("voucher redeem", () => {
  const expiry = nowSec + 86400;
  const created = buildCreateVouchers({ account: acct(creator.publicKey()), asset: "native", amounts: ["10"], expiry, feePerOperation: 100, now: NOW });
  const link = { secret: created.cards[0].secret, balanceId: created.cards[0].balanceId };

  it("native: createAccount → claim → merge, signed by recipient and voucher key", () => {
    const plan = buildRedeem({ recipient: acct(recipient.publicKey()), link, balance: balanceFrom(created, 0), feePerOperation: 100, now: NOW });
    const tx = guardTransaction(plan.xdr, { ...plan.intent, source: recipient.publicKey() }, NOW);
    expect(tx.operations.map(o => o.type)).toEqual(["createAccount", "claimClaimableBalance", "accountMerge"]);
    expect(tx.operations.slice(1).every(o => o.source === plan.voucherKey)).toBe(true);
    tx.sign(recipient);
    tx.sign(Keypair.fromSecret(link.secret));
    const parsed = TransactionBuilder.fromXDR(tx.toXDR(), Networks.PUBLIC);
    expect(parsed.signatures).toHaveLength(2);
  });

  it("USDC: adds recipient trustline when missing and routes funds through the temporary account", () => {
    const c = buildCreateVouchers({ account: acct(creator.publicKey(), "100", [usdcLine("50")]), asset: USDC, amounts: ["7.5"], expiry, feePerOperation: 100, now: NOW });
    const plan = buildRedeem({ recipient: acct(recipient.publicKey()), link: { secret: c.cards[0].secret, balanceId: c.cards[0].balanceId }, balance: balanceFrom(c, 0, USDC), feePerOperation: 100, now: NOW });
    const tx = guardTransaction(plan.xdr, { ...plan.intent, source: recipient.publicKey() }, NOW);
    expect(tx.operations.map(o => o.type)).toEqual(["changeTrust", "createAccount", "changeTrust", "claimClaimableBalance", "payment", "changeTrust", "accountMerge"]);
    expect(plan.addsTrustline).toBe(true);
  });

  it("refuses expired, mismatched, foreign-shaped and unfunded redemptions", () => {
    const balance = balanceFrom(created, 0);
    const base = { recipient: acct(recipient.publicKey()), link, balance, feePerOperation: 100 };
    expect(attempt(() => buildRedeem({ ...base, now: (expiry - 60) * 1000 }))).toBe("expired");
    expect(attempt(() => buildRedeem({ ...base, now: NOW, link: { ...link, balanceId: "00000000" + "cd".repeat(32) } }))).toBe("invalid_link");
    expect(attempt(() => buildRedeem({ ...base, now: NOW, balance: { ...balance, claimants: [balance.claimants[0]] } }))).toBe("not_claimable");
    expect(attempt(() => buildRedeem({ ...base, now: NOW, link: { ...link, secret: Keypair.random().secret() } }))).toBe("not_claimable");
    expect(attempt(() => buildRedeem({ ...base, now: NOW, recipient: acct(recipient.publicKey(), "1.5") }))).toBe("insufficient_balance");
  });
});

describe("voucher refund", () => {
  const expiry = nowSec + 86400;
  const created = buildCreateVouchers({ account: acct(creator.publicKey()), asset: "native", amounts: ["3", "4"], expiry, feePerOperation: 100, now: NOW });
  const balances = [balanceFrom(created, 0), balanceFrom(created, 1)];

  it("only after expiry, only by the creator", () => {
    expect(attempt(() => buildRefund({ account: acct(creator.publicKey()), balances, feePerOperation: 100, now: NOW }))).toBe("not_expired");
    expect(attempt(() => buildRefund({ account: acct(recipient.publicKey()), balances, feePerOperation: 100, now: (expiry + 10) * 1000 }))).toBe("not_creator");
    const plan = buildRefund({ account: acct(creator.publicKey()), balances, feePerOperation: 100, now: (expiry + 10) * 1000 });
    const tx = guardTransaction(plan.xdr, { ...plan.intent, source: creator.publicKey() }, (expiry + 10) * 1000);
    expect(tx.operations.map(o => o.type)).toEqual(["claimClaimableBalance", "claimClaimableBalance"]);
  });
});

describe("predicates", () => {
  it("normalises Horizon JSON and evaluates time conditions", () => {
    const p = normalisePredicate({ not: { abs_before: "2027-01-01T00:00:00Z", abs_before_epoch: "1798761600" } });
    expect(p).toEqual({ type: "not", predicate: { type: "beforeAbsolute", epoch: 1798761600 } });
    expect(predicateHolds(p, 1798761599, null)).toBe(false);
    expect(predicateHolds(p, 1798761600, null)).toBe(true);
    expect(predicateHolds(normalisePredicate({ weird: 1 }), 0, null)).toBe(false);
    expect(predicateHolds(normalisePredicate({ unconditional: true }), 0, null)).toBe(true);
  });

  it("recognises only the NEXORA voucher shape", () => {
    const created = buildCreateVouchers({ account: acct(creator.publicKey()), asset: "native", amounts: ["1"], expiry: nowSec + 7200, feePerOperation: 100, now: NOW });
    const b = balanceFrom(created, 0);
    expect(voucherExpiry(b, created.cards[0].publicKey)).toEqual({ expiry: nowSec + 7200, unlockAt: null, creator: creator.publicKey() });
    expect(voucherExpiry({ ...b, claimants: [b.claimants[0], { destination: creator.publicKey(), predicate: { type: "unconditional" } }] }, created.cards[0].publicKey)).toBeNull();
  });

  it("splits totals exactly", () => {
    expect(splitEvenly("10", 4)).toEqual(["2.5", "2.5", "2.5", "2.5"]);
    expect(splitEvenly("1", 3)).toBeNull();
  });
});
