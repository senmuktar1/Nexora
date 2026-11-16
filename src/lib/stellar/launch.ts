import {
  Account, Asset, AuthClawbackEnabledFlag, AuthRequiredFlag, AuthRevocableFlag, Claimant, Keypair, Operation, StrKey, TransactionBuilder
} from "@stellar/stellar-sdk";
import { NEXORA_NETWORK_PASSPHRASE, toStroops, type ExpectedOperation, type SignIntent } from "./tx-guard";
import { fromStroops, spendableStroops, MAX_FEE_PER_OPERATION, type AccountState } from "./swap";

/**
 * Classic Stellar asset issuance in one atomic transaction (tx source = the user's wallet,
 * which becomes the distribution account):
 *
 *   createAccount  issuer I (new key generated locally)       — reserve for I
 *   setOptions     (I) home domain + issuer controls          — optional
 *   changeTrust    (wallet) CODE:I
 *   setTrustLineFlags (I) authorize wallet                    — only when authorization is required
 *   payment        (I → wallet) total supply                  — minting
 *   createClaimableBalance (wallet) × N                       — allocations and vesting tranches
 *   setOptions     (I) master weight 0                        — optional permanent fixed supply
 */

export const ISSUER_STARTING_BALANCE = "1.5";
export const MAX_SUPPLY_STROOPS = 9_223_372_036_854_775_807n;
const BASE_RESERVE = 5_000_000n;
const VALIDITY_SECONDS = 180;
const MONTH = 30 * 24 * 60 * 60;
export const MAX_VESTING_TRANCHES = 24;

export type Allocation = { address: string; percent: number; cliffMonths: number; durationMonths: number };

export type LaunchRequest = {
  account: AccountState;
  code: string;
  totalSupply: string;
  homeDomain?: string;
  authRequired: boolean;
  authRevocable: boolean;
  clawback: boolean;
  allocations: Allocation[];
  fixedSupply: boolean;
  /** Optional initial Stellar DEX listing: sell part of the creator amount for XLM. */
  listing?: { amount: string; priceXlm: string } | null;
  feePerOperation: number;
  now?: number;
  issuer?: Keypair;
};

export class LaunchError extends Error {
  constructor(public readonly code:
    | "invalid_code" | "invalid_supply" | "invalid_domain" | "invalid_allocation" | "allocation_over_100"
    | "clawback_requires_revocable" | "invalid_listing" | "auth_required_no_allocations" | "too_many_operations" | "insufficient_balance" | "invalid_fee") {
    super(code);
  }
}

export type LaunchPlan = {
  xdr: string;
  intent: Omit<SignIntent, "source">;
  issuerSecret: string;
  issuerPublic: string;
  assetId: string;
  summary: {
    totalSupply: string;
    creatorAmount: string;
    allocations: { address: string; amount: string; unlocksAt: number | null }[];
    xlmRequired: string;
    networkFee: string;
    operations: number;
  };
};

const unlockPredicate = (at: number) => ({ type: "not" as const, predicate: { type: "beforeAbsolute" as const, epoch: at } });

export function buildClassicLaunch(req: LaunchRequest): LaunchPlan {
  if (!Number.isFinite(req.feePerOperation) || req.feePerOperation < 100 || req.feePerOperation > MAX_FEE_PER_OPERATION) throw new LaunchError("invalid_fee");
  const code = req.code.trim();
  if (!/^[A-Za-z0-9]{1,12}$/.test(code) || code.toUpperCase() === "XLM") throw new LaunchError("invalid_code");
  let supply: bigint;
  try { supply = toStroops(req.totalSupply.trim()); } catch { throw new LaunchError("invalid_supply"); }
  if (supply <= 0n || supply > MAX_SUPPLY_STROOPS) throw new LaunchError("invalid_supply");
  const domain = (req.homeDomain ?? "").trim().toLowerCase();
  if (domain && (!/^(?=.{1,32}$)([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain))) throw new LaunchError("invalid_domain");
  if (req.clawback && !req.authRevocable) throw new LaunchError("clawback_requires_revocable");
  if (req.authRequired && req.allocations.length > 0) throw new LaunchError("auth_required_no_allocations");

  let pctTotal = 0;
  for (const a of req.allocations) {
    if (!StrKey.isValidEd25519PublicKey(a.address) || a.address === req.account.id) throw new LaunchError("invalid_allocation");
    if (!(a.percent > 0) || !Number.isInteger(a.cliffMonths) || a.cliffMonths < 0 || !Number.isInteger(a.durationMonths) || a.durationMonths < 0) throw new LaunchError("invalid_allocation");
    pctTotal += a.percent;
  }
  if (pctTotal >= 100) throw new LaunchError("allocation_over_100");

  const nowSec = Math.floor((req.now ?? Date.now()) / 1000);
  const issuer = req.issuer ?? Keypair.random();
  const I = issuer.publicKey();
  const asset = new Asset(code, I);
  const assetId = `${code}:${I}`;

  // Allocation tranches (basis points to avoid float drift).
  type Tranche = { address: string; amount: bigint; unlocksAt: number | null };
  const tranches: Tranche[] = [];
  let allocated = 0n;
  for (const a of req.allocations) {
    const share = (supply * BigInt(Math.round(a.percent * 100))) / 10_000n;
    if (share <= 0n) throw new LaunchError("invalid_allocation");
    const parts = a.durationMonths > 0 ? Math.min(a.durationMonths, MAX_VESTING_TRANCHES) : 1;
    const per = share / BigInt(parts);
    for (let i = 0; i < parts; i++) {
      const amount = i === parts - 1 ? share - per * BigInt(parts - 1) : per;
      const months = a.cliffMonths + (a.durationMonths > 0 ? Math.round(((i + 1) * a.durationMonths) / parts) : 0);
      tranches.push({ address: a.address, amount, unlocksAt: months > 0 ? nowSec + months * MONTH : null });
    }
    allocated += share;
  }
  const creatorAmount = supply - allocated;
  let listingAmount = 0n;
  if (req.listing) {
    try { listingAmount = toStroops(req.listing.amount.trim()); } catch { throw new LaunchError("invalid_listing"); }
    const price = Number(req.listing.priceXlm);
    if (listingAmount <= 0n || listingAmount > creatorAmount || !/^\d+(\.\d{1,7})?$/.test(req.listing.priceXlm.trim()) || !(price > 0)) throw new LaunchError("invalid_listing");
    if (req.authRequired) throw new LaunchError("invalid_listing");
  }

  const opCount = 1 + (domain || req.authRequired || req.authRevocable || req.clawback ? 1 : 0) + 1 + (req.authRequired ? 1 : 0) + 1 + tranches.length + (req.listing ? 1 : 0) + (req.fixedSupply ? 1 : 0);
  if (opCount > 100) throw new LaunchError("too_many_operations");
  const fee = BigInt(req.feePerOperation) * BigInt(opCount);
  // Wallet funds: issuer reserve + trustline reserve + one reserve per claimable balance + fees.
  const xlmNeeded = toStroops(ISSUER_STARTING_BALANCE) + BASE_RESERVE + BASE_RESERVE * BigInt(tranches.length) + (req.listing ? BASE_RESERVE : 0n) + fee;
  if (spendableStroops(req.account, "native") < xlmNeeded) throw new LaunchError("insufficient_balance");

  const b = new TransactionBuilder(new Account(req.account.id, req.account.sequence), {
    fee: String(req.feePerOperation), networkPassphrase: NEXORA_NETWORK_PASSPHRASE, timebounds: { minTime: 0, maxTime: nowSec + VALIDITY_SECONDS }
  });
  const ops: ExpectedOperation[] = [];
  b.addOperation(Operation.createAccount({ destination: I, startingBalance: ISSUER_STARTING_BALANCE }));
  ops.push({ type: "createAccount", destination: I, startingBalance: ISSUER_STARTING_BALANCE });

  const flags = (req.authRequired ? AuthRequiredFlag : 0) | (req.authRevocable ? AuthRevocableFlag : 0) | (req.clawback ? AuthClawbackEnabledFlag : 0);
  if (domain || flags) {
    b.addOperation(Operation.setOptions({ source: I, homeDomain: domain || undefined, setFlags: flags ? flags as never : undefined }));
    ops.push({ type: "setOptions", source: I, homeDomain: domain || undefined, setFlags: flags || undefined });
  }
  b.addOperation(Operation.changeTrust({ asset }));
  ops.push({ type: "changeTrust", asset: assetId });
  if (req.authRequired) {
    b.addOperation(Operation.setTrustLineFlags({ source: I, trustor: req.account.id, asset, flags: { authorized: true } }));
    ops.push({ type: "setTrustLineFlags", source: I, trustor: req.account.id, asset: assetId, authorized: true });
  }
  b.addOperation(Operation.payment({ source: I, destination: req.account.id, asset, amount: fromStroops(supply) }));
  ops.push({ type: "payment", source: I, destination: req.account.id, asset: assetId, amount: fromStroops(supply) });
  for (const t of tranches) {
    const predicate = t.unlocksAt ? Claimant.predicateNot(Claimant.predicateBeforeAbsoluteTime(String(t.unlocksAt))) : Claimant.predicateUnconditional();
    b.addOperation(Operation.createClaimableBalance({ asset, amount: fromStroops(t.amount), claimants: [new Claimant(t.address, predicate)] }));
    ops.push({ type: "createClaimableBalance", asset: assetId, amount: fromStroops(t.amount), claimants: [{ destination: t.address, predicate: t.unlocksAt ? unlockPredicate(t.unlocksAt) : { type: "unconditional" } }] });
  }
  if (req.listing) {
    const price = req.listing.priceXlm.trim();
    b.addOperation(Operation.manageSellOffer({ selling: asset, buying: Asset.native(), amount: fromStroops(listingAmount), price, offerId: "0" }));
    ops.push({ type: "manageSellOffer", selling: assetId, buying: "native", amount: fromStroops(listingAmount), price });
  }
  if (req.fixedSupply) {
    b.addOperation(Operation.setOptions({ source: I, masterWeight: 0 }));
    ops.push({ type: "setOptions", source: I, masterWeight: 0 });
  }

  return {
    xdr: b.build().toEnvelope().toXDR("base64"),
    intent: { networkPassphrase: NEXORA_NETWORK_PASSPHRASE, operations: ops, maxFeeStroops: Number(fee), maxValiditySeconds: VALIDITY_SECONDS + 5 },
    issuerSecret: issuer.secret(),
    issuerPublic: I,
    assetId,
    summary: {
      totalSupply: fromStroops(supply),
      creatorAmount: fromStroops(creatorAmount),
      allocations: tranches.map(t => ({ address: t.address, amount: fromStroops(t.amount), unlocksAt: t.unlocksAt })),
      xlmRequired: fromStroops(xlmNeeded),
      networkFee: fromStroops(fee),
      operations: opCount
    }
  };
}

/** SEP-1 stellar.toml for the issuer's home domain. Values are escaped; nothing is asserted that the user didn't enter. */
export function buildStellarToml(input: {
  code: string; issuer: string; name: string; description: string; image?: string; fixedSupply: boolean;
  isAssetAnchored?: boolean; anchorAssetType?: string; anchorAsset?: string; redemptionInstructions?: string; attestationUrl?: string;
}): string {
  const q = (v: string) => JSON.stringify(v.slice(0, 500));
  const lines = [
    "[[CURRENCIES]]",
    `code=${q(input.code)}`,
    `issuer=${q(input.issuer)}`,
    "display_decimals=7",
    `name=${q(input.name || input.code)}`,
    `desc=${q(input.description)}`,
    input.image ? `image=${q(input.image)}` : null,
    input.fixedSupply ? "fixed_number=true" : null,
    input.isAssetAnchored ? "is_asset_anchored=true" : null,
    input.anchorAssetType ? `anchor_asset_type=${q(input.anchorAssetType)}` : null,
    input.anchorAsset ? `anchor_asset=${q(input.anchorAsset)}` : null,
    input.redemptionInstructions ? `redemption_instructions=${q(input.redemptionInstructions)}` : null,
    input.attestationUrl ? `attestation_of_reserve=${q(input.attestationUrl)}` : null
  ];
  return lines.filter(Boolean).join("\n") + "\n";
}
