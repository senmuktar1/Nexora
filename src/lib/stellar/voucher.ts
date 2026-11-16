import { Account, Claimant, Keypair, Operation, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import { NEXORA_NETWORK_PASSPHRASE, parseAssetId, toStroops, type AssetId, type ExpectedOperation, type ExpectedPredicate, type SignIntent } from "./tx-guard";
import { fromStroops, hasTrustline, spendableStroops, MAX_FEE_PER_OPERATION, type AccountState } from "./swap";

/**
 * Vouchers on Stellar claimable balances.
 *
 * Each voucher card is a claimable balance with two claimants:
 *  - a one-time voucher key E: may claim only BEFORE the expiry;
 *  - the creator: may claim only AFTER the expiry (refund).
 * The chain enforces single redemption, expiry and refund eligibility.
 *
 * The voucher link carries E's secret in the URL fragment (never sent to servers):
 *   https://<host>/redeem#k=<S…>&b=<balance id hex>
 */

export const VOUCHER_ASSETS: Record<string, { code: string; label: string; assetId: AssetId }> = {
  native: { code: "XLM", label: "Stellar Lumens", assetId: "native" },
  usdc: { code: "USDC", label: "USD Coin (Circle)", assetId: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" }
};
const ALLOWED_ASSET_IDS = new Set(Object.values(VOUCHER_ASSETS).map(a => a.assetId));

export const MAX_CARDS = 50;
export const MIN_EXPIRY_SECONDS = 60 * 60; // 1 hour
export const MAX_EXPIRY_SECONDS = 365 * 24 * 60 * 60;
/** Starting balance for the temporary voucher account during redemption (returned by merge). */
export const REDEEM_STARTING_BALANCE = { native: "1", credit: "1.5" } as const;
const VALIDITY_SECONDS = 180;
const BASE_RESERVE = 5_000_000n;

export class VoucherError extends Error {
  constructor(public readonly code:
    | "invalid_link" | "invalid_amount" | "too_many_cards" | "invalid_expiry" | "unsupported_asset"
    | "insufficient_balance" | "invalid_fee" | "not_claimable" | "expired" | "not_unlocked" | "not_expired" | "not_creator" | "already_claimed") {
    super(code);
  }
}

// ---------- links ----------

export type VoucherLink = { secret: string; balanceId: string };

export function encodeVoucherLink(origin: string, link: VoucherLink): string {
  return `${origin.replace(/\/$/, "")}/redeem#k=${link.secret}&b=${link.balanceId}`;
}

/** Accepts a full URL, a "#k=…&b=…" fragment or the bare "k=…&b=…" string. */
export function decodeVoucherLink(input: string): VoucherLink {
  const raw = input.trim();
  const fragment = raw.includes("#") ? raw.slice(raw.indexOf("#") + 1) : raw;
  const params = new URLSearchParams(fragment);
  const secret = (params.get("k") ?? "").trim().toUpperCase();
  const balanceId = (params.get("b") ?? "").trim().toLowerCase();
  if (!StrKey.isValidEd25519SecretSeed(secret) || !/^[0-9a-f]{72}$/.test(balanceId)) throw new VoucherError("invalid_link");
  return { secret, balanceId };
}

// ---------- predicates (Horizon JSON → normalised) ----------

export type Predicate =
  | { type: "unconditional" }
  | { type: "beforeAbsolute"; epoch: number }
  | { type: "beforeRelative"; seconds: number }
  | { type: "not"; predicate: Predicate }
  | { type: "and"; predicates: Predicate[] }
  | { type: "or"; predicates: Predicate[] };

/** Normalises Horizon's claimant predicate JSON. Unknown shapes become a never-claimable predicate. */
export function normalisePredicate(raw: unknown, depth = 0): Predicate {
  const p = raw as Record<string, unknown> | null;
  if (!p || depth > 4) return { type: "beforeAbsolute", epoch: 0 };
  if (p.unconditional === true) return { type: "unconditional" };
  if (typeof p.abs_before_epoch === "string" || typeof p.abs_before_epoch === "number") return { type: "beforeAbsolute", epoch: Number(p.abs_before_epoch) };
  if (typeof p.abs_before === "string") { const t = Date.parse(p.abs_before); return { type: "beforeAbsolute", epoch: Number.isFinite(t) ? Math.floor(t / 1000) : 0 }; }
  if (p.rel_before !== undefined) return { type: "beforeRelative", seconds: Number(p.rel_before) };
  if (p.not) return { type: "not", predicate: normalisePredicate(p.not, depth + 1) };
  if (Array.isArray(p.and)) return { type: "and", predicates: p.and.map(x => normalisePredicate(x, depth + 1)) };
  if (Array.isArray(p.or)) return { type: "or", predicates: p.or.map(x => normalisePredicate(x, depth + 1)) };
  return { type: "beforeAbsolute", epoch: 0 };
}

/** Whether a predicate is satisfied at `nowSec`. Relative predicates need the creation time. */
export function predicateHolds(p: Predicate, nowSec: number, createdSec: number | null): boolean {
  switch (p.type) {
    case "unconditional": return true;
    case "beforeAbsolute": return nowSec < p.epoch;
    case "beforeRelative": return createdSec !== null && nowSec < createdSec + p.seconds;
    case "not": return !predicateHolds(p.predicate, nowSec, createdSec);
    case "and": return p.predicates.every(x => predicateHolds(x, nowSec, createdSec));
    case "or": return p.predicates.some(x => predicateHolds(x, nowSec, createdSec));
  }
}

export type ClaimableBalance = {
  id: string;
  asset: AssetId;
  amount: string;
  sponsor: string | null;
  createdAt: string | null;
  claimants: { destination: string; predicate: Predicate }[];
};

/**
 * The voucher shape NEXORA creates:
 *   E: before(T)  or  and(not(before(U)), before(T))   — claimable from U (optional) until T
 *   creator: not(before(T))                             — refundable from T
 */
export function voucherExpiry(balance: ClaimableBalance, voucherKey: string): { expiry: number; unlockAt: number | null; creator: string } | null {
  if (balance.claimants.length !== 2) return null;
  const e = balance.claimants.find(c => c.destination === voucherKey);
  const creator = balance.claimants.find(c => c.destination !== voucherKey);
  if (!e || !creator) return null;
  let t: number, unlockAt: number | null = null;
  const ep = e.predicate;
  if (ep.type === "beforeAbsolute") t = ep.epoch;
  else if (ep.type === "and" && ep.predicates.length === 2 && ep.predicates[0].type === "not" && ep.predicates[0].predicate.type === "beforeAbsolute" && ep.predicates[1].type === "beforeAbsolute") {
    unlockAt = ep.predicates[0].predicate.epoch;
    t = ep.predicates[1].epoch;
    if (unlockAt >= t) return null;
  } else return null;
  if (creator.predicate.type !== "not" || creator.predicate.predicate.type !== "beforeAbsolute" || creator.predicate.predicate.epoch !== t) return null;
  return { expiry: t, unlockAt, creator: creator.destination };
}

// ---------- create ----------

export type CreatePlan = {
  xdr: string;
  intent: Omit<SignIntent, "source">;
  cards: { secret: string; publicKey: string; amount: string; balanceId: string }[];
  expiry: number;
  unlockAt: number | null;
  total: string;
  reserveLocked: string;
  networkFee: string;
};

function checkFee(fee: number) {
  if (!Number.isFinite(fee) || fee < 100 || fee > MAX_FEE_PER_OPERATION) throw new VoucherError("invalid_fee");
}

const voucherPredicate = (expiry: number, unlockAt: number | null): ExpectedPredicate => unlockAt
  ? { type: "and", predicates: [{ type: "not", predicate: { type: "beforeAbsolute", epoch: unlockAt } }, { type: "beforeAbsolute", epoch: expiry }] }
  : { type: "beforeAbsolute", epoch: expiry };
const refundPredicate = (expiry: number): ExpectedPredicate => ({ type: "not", predicate: { type: "beforeAbsolute", epoch: expiry } });

export function buildCreateVouchers(req: {
  account: AccountState;
  asset: AssetId;
  amounts: string[];
  expiry: number;
  /** Optional: earliest time the recipient can claim. */
  unlockAt?: number | null;
  feePerOperation: number;
  now?: number;
  generateKey?: () => Keypair;
}): CreatePlan {
  const unlockAt = req.unlockAt ?? null;
  if (!ALLOWED_ASSET_IDS.has(req.asset)) throw new VoucherError("unsupported_asset");
  if (req.amounts.length < 1 || req.amounts.length > MAX_CARDS) throw new VoucherError("too_many_cards");
  checkFee(req.feePerOperation);
  const nowSec = Math.floor((req.now ?? Date.now()) / 1000);
  if (!Number.isInteger(req.expiry) || req.expiry < nowSec + MIN_EXPIRY_SECONDS || req.expiry > nowSec + MAX_EXPIRY_SECONDS) throw new VoucherError("invalid_expiry");
  if (unlockAt !== null && (!Number.isInteger(unlockAt) || unlockAt <= nowSec || unlockAt >= req.expiry - MIN_EXPIRY_SECONDS)) throw new VoucherError("invalid_expiry");
  let total = 0n;
  const amounts = req.amounts.map(a => {
    let v: bigint;
    try { v = toStroops(a); } catch { throw new VoucherError("invalid_amount"); }
    if (v <= 0n) throw new VoucherError("invalid_amount");
    total += v;
    return v;
  });
  if (req.asset !== "native" && !hasTrustline(req.account, req.asset)) throw new VoucherError("insufficient_balance");

  const ops = amounts.length;
  const fee = BigInt(req.feePerOperation) * BigInt(ops);
  const reserve = BASE_RESERVE * BigInt(ops); // each claimable balance locks one base reserve
  if (req.asset === "native") {
    if (spendableStroops(req.account, "native", ops, fee) < total) throw new VoucherError("insufficient_balance");
  } else {
    if (spendableStroops(req.account, req.asset) < total) throw new VoucherError("insufficient_balance");
    if (spendableStroops(req.account, "native", ops, fee) <= 0n) throw new VoucherError("insufficient_balance");
  }

  const builder = new TransactionBuilder(new Account(req.account.id, req.account.sequence), {
    fee: String(req.feePerOperation), networkPassphrase: NEXORA_NETWORK_PASSPHRASE, timebounds: { minTime: 0, maxTime: nowSec + VALIDITY_SECONDS }
  });
  const asset = parseAssetId(req.asset);
  const keys = amounts.map(() => req.generateKey ? req.generateKey() : Keypair.random());
  const expected: ExpectedOperation[] = [];
  amounts.forEach((v, i) => {
    const amount = fromStroops(v);
    builder.addOperation(Operation.createClaimableBalance({
      asset, amount,
      claimants: [
        new Claimant(keys[i].publicKey(), unlockAt
          ? Claimant.predicateAnd(Claimant.predicateNot(Claimant.predicateBeforeAbsoluteTime(String(unlockAt))), Claimant.predicateBeforeAbsoluteTime(String(req.expiry)))
          : Claimant.predicateBeforeAbsoluteTime(String(req.expiry))),
        new Claimant(req.account.id, Claimant.predicateNot(Claimant.predicateBeforeAbsoluteTime(String(req.expiry))))
      ]
    }));
    expected.push({ type: "createClaimableBalance", asset: req.asset, amount, claimants: [
      { destination: keys[i].publicKey(), predicate: voucherPredicate(req.expiry, unlockAt) },
      { destination: req.account.id, predicate: refundPredicate(req.expiry) }
    ] });
  });
  const tx = builder.build();
  return {
    xdr: tx.toEnvelope().toXDR("base64"),
    intent: { networkPassphrase: NEXORA_NETWORK_PASSPHRASE, operations: expected, maxFeeStroops: Number(fee), maxValiditySeconds: VALIDITY_SECONDS + 5 },
    cards: keys.map((k, i) => ({ secret: k.secret(), publicKey: k.publicKey(), amount: fromStroops(amounts[i]), balanceId: tx.getClaimableBalanceId(i) })),
    expiry: req.expiry,
    unlockAt,
    total: fromStroops(total),
    reserveLocked: fromStroops(reserve),
    networkFee: fromStroops(fee)
  };
}

// ---------- redeem ----------

export type RedeemPlan = {
  xdr: string;
  intent: Omit<SignIntent, "source">;
  voucherKey: string;
  amount: string;
  asset: AssetId;
  addsTrustline: boolean;
  temporaryReserve: string;
  networkFee: string;
};

/**
 * Atomic redemption into the recipient's account:
 *   [changeTrust (recipient), if needed]
 *   createAccount E (recipient funds the temporary reserve)
 *   [changeTrust asset (E)]           — credit assets only
 *   claimClaimableBalance (E)
 *   [payment amount E → recipient]    — credit assets only
 *   [changeTrust asset limit 0 (E)]   — credit assets only
 *   accountMerge E → recipient        — returns the reserve (and XLM for native vouchers)
 */
export function buildRedeem(req: {
  recipient: AccountState;
  link: VoucherLink;
  balance: ClaimableBalance;
  feePerOperation: number;
  now?: number;
}): RedeemPlan {
  checkFee(req.feePerOperation);
  const e = Keypair.fromSecret(req.link.secret).publicKey();
  if (req.balance.id.toLowerCase() !== req.link.balanceId) throw new VoucherError("invalid_link");
  if (!ALLOWED_ASSET_IDS.has(req.balance.asset)) throw new VoucherError("unsupported_asset");
  const shape = voucherExpiry(req.balance, e);
  if (!shape) throw new VoucherError("not_claimable");
  const nowSec = Math.floor((req.now ?? Date.now()) / 1000);
  // Must remain claimable for the whole validity window of this transaction.
  if (nowSec + VALIDITY_SECONDS >= shape.expiry) throw new VoucherError("expired");
  if (shape.unlockAt !== null && nowSec < shape.unlockAt) throw new VoucherError("not_unlocked");
  if (req.recipient.id === e) throw new VoucherError("not_claimable");

  const native = req.balance.asset === "native";
  const addsTrustline = !native && !hasTrustline(req.recipient, req.balance.asset);
  const start = native ? REDEEM_STARTING_BALANCE.native : REDEEM_STARTING_BALANCE.credit;
  const opCount = (addsTrustline ? 1 : 0) + (native ? 3 : 6);
  const fee = BigInt(req.feePerOperation) * BigInt(opCount);
  if (spendableStroops(req.recipient, "native", addsTrustline ? 1 : 0, fee) < toStroops(start)) throw new VoucherError("insufficient_balance");

  const asset = parseAssetId(req.balance.asset);
  const b = new TransactionBuilder(new Account(req.recipient.id, req.recipient.sequence), {
    fee: String(req.feePerOperation), networkPassphrase: NEXORA_NETWORK_PASSPHRASE, timebounds: { minTime: 0, maxTime: nowSec + VALIDITY_SECONDS }
  });
  const ops: ExpectedOperation[] = [];
  const amount = fromStroops(toStroops(req.balance.amount));
  if (addsTrustline) { b.addOperation(Operation.changeTrust({ asset })); ops.push({ type: "changeTrust", asset: req.balance.asset }); }
  b.addOperation(Operation.createAccount({ destination: e, startingBalance: start }));
  ops.push({ type: "createAccount", destination: e, startingBalance: start });
  if (!native) { b.addOperation(Operation.changeTrust({ asset, source: e })); ops.push({ type: "changeTrust", asset: req.balance.asset, source: e }); }
  b.addOperation(Operation.claimClaimableBalance({ balanceId: req.balance.id, source: e }));
  ops.push({ type: "claimClaimableBalance", balanceId: req.balance.id, source: e });
  if (!native) {
    b.addOperation(Operation.payment({ destination: req.recipient.id, asset, amount, source: e }));
    ops.push({ type: "payment", destination: req.recipient.id, asset: req.balance.asset, amount, source: e });
    b.addOperation(Operation.changeTrust({ asset, limit: "0", source: e }));
    ops.push({ type: "changeTrust", asset: req.balance.asset, limit: "0", source: e });
  }
  b.addOperation(Operation.accountMerge({ destination: req.recipient.id, source: e }));
  ops.push({ type: "accountMerge", destination: req.recipient.id, source: e });

  return {
    xdr: b.build().toEnvelope().toXDR("base64"),
    intent: { networkPassphrase: NEXORA_NETWORK_PASSPHRASE, operations: ops, maxFeeStroops: Number(fee), maxValiditySeconds: VALIDITY_SECONDS + 5 },
    voucherKey: e,
    amount,
    asset: req.balance.asset,
    addsTrustline,
    temporaryReserve: start,
    networkFee: fromStroops(fee)
  };
}

// ---------- refund ----------

export function buildRefund(req: { account: AccountState; balances: ClaimableBalance[]; feePerOperation: number; now?: number }) {
  checkFee(req.feePerOperation);
  if (req.balances.length < 1 || req.balances.length > MAX_CARDS) throw new VoucherError("too_many_cards");
  const nowSec = Math.floor((req.now ?? Date.now()) / 1000);
  const b = new TransactionBuilder(new Account(req.account.id, req.account.sequence), {
    fee: String(req.feePerOperation), networkPassphrase: NEXORA_NETWORK_PASSPHRASE, timebounds: { minTime: 0, maxTime: nowSec + VALIDITY_SECONDS }
  });
  const ops: ExpectedOperation[] = [];
  for (const balance of req.balances) {
    const mine = balance.claimants.find(c => c.destination === req.account.id);
    if (!mine) throw new VoucherError("not_creator");
    // Must already be claimable by the creator (i.e. expired) right now.
    if (!predicateHolds(mine.predicate, nowSec, balance.createdAt ? Math.floor(Date.parse(balance.createdAt) / 1000) : null)) throw new VoucherError("not_expired");
    b.addOperation(Operation.claimClaimableBalance({ balanceId: balance.id }));
    ops.push({ type: "claimClaimableBalance", balanceId: balance.id });
  }
  const fee = BigInt(req.feePerOperation) * BigInt(ops.length);
  return {
    xdr: b.build().toEnvelope().toXDR("base64"),
    intent: { networkPassphrase: NEXORA_NETWORK_PASSPHRASE, operations: ops, maxFeeStroops: Number(fee), maxValiditySeconds: VALIDITY_SECONDS + 5 } as Omit<SignIntent, "source">,
    networkFee: fromStroops(fee)
  };
}

/** Splits a total evenly into n cards (7-decimal precision); returns null if it doesn't divide exactly. */
export function splitEvenly(total: string, n: number): string[] | null {
  let t: bigint;
  try { t = toStroops(total); } catch { return null; }
  if (n < 1 || n > MAX_CARDS || t <= 0n || t % BigInt(n) !== 0n) return null;
  return Array.from({ length: n }, () => fromStroops(t / BigInt(n)));
}
