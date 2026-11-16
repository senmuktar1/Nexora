import { Buffer } from "buffer";
import {
  Address,
  Asset,
  hash,
  FeeBumpTransaction,
  Networks,
  StrKey,
  Transaction,
  TransactionBuilder,
  type Operation
} from "@stellar/stellar-sdk";

/**
 * Pre-sign transaction guard.
 *
 * Every transaction NEXORA signs is checked against an explicit "intent" that the
 * calling module declares from what the user actually reviewed. If the XDR differs
 * in any material way — network, source, sequence-source, operation list, assets,
 * destinations, amounts, fee or validity window — signing is refused.
 */

export const NEXORA_NETWORK_PASSPHRASE = Networks.PUBLIC;

/** "native" or "CODE:ISSUER" (classic) — never a bare ticker. */
export type AssetId = string;

/** Claim condition, mirroring Stellar claim predicates. */
export type ExpectedPredicate =
  | { type: "unconditional" }
  | { type: "beforeAbsolute"; epoch: number }
  | { type: "not"; predicate: ExpectedPredicate }
  | { type: "and"; predicates: [ExpectedPredicate, ExpectedPredicate] };

export type ExpectedClaimant = { destination: string; predicate: ExpectedPredicate };

type OperationBody =
  | { type: "payment"; destination: string; asset: AssetId; amount: string }
  | { type: "createAccount"; destination: string; startingBalance: string }
  | { type: "pathPaymentStrictSend"; sendAsset: AssetId; sendAmount: string; destination: string; destAsset: AssetId; destMin: string; maxPathLength?: number }
  | { type: "pathPaymentStrictReceive"; sendAsset: AssetId; sendMax: string; destination: string; destAsset: AssetId; destAmount: string; maxPathLength?: number }
  | { type: "changeTrust"; asset: AssetId; limit?: string }
  | { type: "createClaimableBalance"; asset: AssetId; amount: string; claimants: ExpectedClaimant[] }
  | { type: "accountMerge"; destination: string }
  | { type: "claimClaimableBalance"; balanceId: string }
  | { type: "manageData"; name: string; value: string | null }
  | { type: "setOptions"; homeDomain?: string; setFlags?: number; clearFlags?: number; masterWeight?: 0 }
  | { type: "setTrustLineFlags"; trustor: string; asset: AssetId; authorized: true }
  | { type: "manageSellOffer"; selling: AssetId; buying: AssetId; amount: string; price: string }
  | { type: "invokeContract"; contractId: string; functionName: string; /** Exact base64 ScVal XDR of every argument. */ args?: string[] }
  /** Upload contract code: the wasm's SHA-256 must equal wasmHash (hex). */
  | { type: "uploadContractWasm"; wasmHash: string }
  /** Create a contract from installed code: deployer + salt + wasm hash + exact constructor args. */
  | { type: "createContract"; wasmHash: string; deployer: string; salt: string; constructorArgs: string[] };

/** `source` is the operation's source account; omitted means the transaction source. */
export type ExpectedOperation = OperationBody & { source?: string };

export type SignIntent = {
  networkPassphrase: string;
  source: string;
  operations: ExpectedOperation[];
  /** Upper bound on the total fee in stroops the user agreed to. */
  maxFeeStroops: number;
  /** Max seconds from now the transaction may remain valid. Default 300. */
  maxValiditySeconds?: number;
  memo?: { type: "none" } | { type: "text"; value: string } | { type: "id"; value: string } | { type: "hash"; value: string };
};

export class TxGuardError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "TxGuardError";
  }
}

export function assetId(asset: Asset): AssetId {
  return asset.isNative() ? "native" : `${asset.getCode()}:${asset.getIssuer()}`;
}

export function parseAssetId(id: AssetId): Asset {
  if (id === "native") return Asset.native();
  const [code, issuer, extra] = id.split(":");
  if (extra !== undefined || !code || !issuer || !/^[A-Za-z0-9]{1,12}$/.test(code) || !StrKey.isValidEd25519PublicKey(issuer)) {
    throw new TxGuardError("invalid_asset_id");
  }
  return new Asset(code, issuer);
}

function fail(reason: string): never {
  throw new TxGuardError(reason);
}

function sameAmount(actual: string, expected: string) {
  // Horizon/SDK amounts are 7-decimal strings; compare in stroops to avoid formatting drift.
  return toStroops(actual) === toStroops(expected);
}

export function toStroops(amount: string): bigint {
  if (!/^\d+(\.\d{1,7})?$/.test(amount)) fail("invalid_amount");
  const [whole, frac = ""] = amount.split(".");
  return BigInt(whole) * 10_000_000n + BigInt(frac.padEnd(7, "0"));
}

function sameAsset(actual: Asset, expected: AssetId) {
  return assetId(actual) === assetId(parseAssetId(expected));
}

/** Hex of Hash / Uint256 / Uint8Array values across SDK XDR representations. */
function bytesHex(v: unknown): string {
  if (v instanceof Uint8Array) return Buffer.from(v).toString("hex");
  if (v && typeof v === "object" && "value" in v) return bytesHex((v as { value: unknown }).value);
  if (typeof v === "function") return bytesHex((v as () => unknown)());
  return "";
}

function sha256HexSync(bytes: Uint8Array): string {
  return Buffer.from(hash(Buffer.from(bytes))).toString("hex");
}

function samePredicate(actual: unknown, expected: ExpectedPredicate): boolean {
  const a = actual as { type?: string; absBefore?: unknown; notPredicate?: unknown; andPredicates?: unknown[] } | null;
  if (!a) return false;
  switch (expected.type) {
    case "unconditional": return a.type === "claimPredicateUnconditional";
    case "beforeAbsolute": return a.type === "claimPredicateBeforeAbsoluteTime" && String(a.absBefore) === String(expected.epoch);
    case "not": return a.type === "claimPredicateNot" && samePredicate(a.notPredicate, expected.predicate);
    case "and": return a.type === "claimPredicateAnd" && Array.isArray(a.andPredicates) && a.andPredicates.length === 2
      && samePredicate(a.andPredicates[0], expected.predicates[0]) && samePredicate(a.andPredicates[1], expected.predicates[1]);
  }
}

function checkOperation(op: Operation, expected: ExpectedOperation, source: string, index: number) {
  const where = `op_${index}`;
  const opType = (op as { type: string }).type;
  const isHostFn = expected.type === "invokeContract" || expected.type === "uploadContractWasm" || expected.type === "createContract";
  if (opType !== expected.type && !(isHostFn && opType === "invokeHostFunction")) {
    fail(`${where}_type_mismatch`);
  }
  // Effective source = explicit op source, else the transaction source. Must match exactly.
  const effectiveSource = (op as { source?: string }).source ?? source;
  if (effectiveSource !== (expected.source ?? source)) fail(`${where}_source_mismatch`);

  switch (expected.type) {
    case "payment": {
      const o = op as Operation.Payment;
      if (o.destination !== expected.destination) fail(`${where}_destination_mismatch`);
      if (!sameAsset(o.asset, expected.asset)) fail(`${where}_asset_mismatch`);
      if (!sameAmount(o.amount, expected.amount)) fail(`${where}_amount_mismatch`);
      return;
    }
    case "createAccount": {
      const o = op as Operation.CreateAccount;
      if (o.destination !== expected.destination) fail(`${where}_destination_mismatch`);
      if (!sameAmount(o.startingBalance, expected.startingBalance)) fail(`${where}_amount_mismatch`);
      return;
    }
    case "pathPaymentStrictSend": {
      const o = op as Operation.PathPaymentStrictSend;
      if (o.destination !== expected.destination) fail(`${where}_destination_mismatch`);
      if (!sameAsset(o.sendAsset, expected.sendAsset) || !sameAsset(o.destAsset, expected.destAsset)) fail(`${where}_asset_mismatch`);
      if (!sameAmount(o.sendAmount, expected.sendAmount)) fail(`${where}_amount_mismatch`);
      if (toStroops(o.destMin) < toStroops(expected.destMin)) fail(`${where}_min_received_lowered`);
      if (o.path.length > (expected.maxPathLength ?? 5)) fail(`${where}_path_too_long`);
      return;
    }
    case "pathPaymentStrictReceive": {
      const o = op as Operation.PathPaymentStrictReceive;
      if (o.destination !== expected.destination) fail(`${where}_destination_mismatch`);
      if (!sameAsset(o.sendAsset, expected.sendAsset) || !sameAsset(o.destAsset, expected.destAsset)) fail(`${where}_asset_mismatch`);
      if (!sameAmount(o.destAmount, expected.destAmount)) fail(`${where}_amount_mismatch`);
      if (toStroops(o.sendMax) > toStroops(expected.sendMax)) fail(`${where}_max_sent_raised`);
      if (o.path.length > (expected.maxPathLength ?? 5)) fail(`${where}_path_too_long`);
      return;
    }
    case "changeTrust": {
      const o = op as Operation.ChangeTrust;
      if (!(o.line instanceof Asset) || !sameAsset(o.line, expected.asset)) fail(`${where}_asset_mismatch`);
      if (expected.limit !== undefined && !sameAmount(o.limit, expected.limit)) fail(`${where}_limit_mismatch`);
      return;
    }
    case "createClaimableBalance": {
      const o = op as Operation.CreateClaimableBalance;
      if (!sameAsset(o.asset, expected.asset)) fail(`${where}_asset_mismatch`);
      if (!sameAmount(o.amount, expected.amount)) fail(`${where}_amount_mismatch`);
      if (o.claimants.length !== expected.claimants.length) fail(`${where}_claimants_mismatch`);
      for (const want of expected.claimants) {
        const match = o.claimants.find(c => c.destination === want.destination);
        if (!match) fail(`${where}_claimants_mismatch`);
        if (!samePredicate(match.predicate, want.predicate)) fail(`${where}_predicate_mismatch`);
      }
      return;
    }
    case "setTrustLineFlags": {
      const o = op as unknown as { trustor: string; asset: Asset; flags: Record<string, boolean | undefined> };
      if (o.trustor !== expected.trustor) fail(`${where}_trustor_mismatch`);
      if (!sameAsset(o.asset, expected.asset)) fail(`${where}_asset_mismatch`);
      const keys = Object.entries(o.flags ?? {}).filter(([, v]) => v !== undefined);
      if (keys.length !== 1 || keys[0][0] !== "authorized" || keys[0][1] !== true) fail(`${where}_flags_mismatch`);
      return;
    }
    case "manageSellOffer": {
      const o = op as Operation.ManageSellOffer;
      if (!sameAsset(o.selling, expected.selling) || !sameAsset(o.buying, expected.buying)) fail(`${where}_asset_mismatch`);
      if (!sameAmount(o.amount, expected.amount)) fail(`${where}_amount_mismatch`);
      if (String(o.offerId) !== "0") fail(`${where}_offer_mismatch`);
      const want = Number(expected.price), got = Number(o.price);
      if (!(want > 0) || Math.abs(got - want) > want * 1e-7) fail(`${where}_price_mismatch`);
      return;
    }
    case "accountMerge": {
      const o = op as Operation.AccountMerge;
      if (o.destination !== expected.destination) fail(`${where}_destination_mismatch`);
      return;
    }
    case "claimClaimableBalance": {
      const o = op as Operation.ClaimClaimableBalance;
      if (o.balanceId.toLowerCase() !== expected.balanceId.toLowerCase()) fail(`${where}_balance_id_mismatch`);
      return;
    }
    case "manageData": {
      const o = op as Operation.ManageData;
      if (o.name !== expected.name) fail(`${where}_name_mismatch`);
      const value = o.value === undefined || o.value === null ? null : Buffer.from(o.value as Uint8Array).toString("utf8");
      if (value !== expected.value) fail(`${where}_value_mismatch`);
      return;
    }
    case "setOptions": {
      const o = op as Operation.SetOptions;
      // Only explicitly expected fields may be set; signers/thresholds/inflation are always refused.
      if (o.signer !== undefined || o.lowThreshold !== undefined
        || o.medThreshold !== undefined || o.highThreshold !== undefined || o.inflationDest !== undefined) fail(`${where}_unsafe_set_options`);
      // Master weight may only be set to 0, only when explicitly expected, and never on the wallet's own account
      // (used to lock a newly created issuer for a fixed supply).
      if (o.masterWeight !== undefined || expected.masterWeight !== undefined) {
        const onOtherAccount = expected.source !== undefined && expected.source !== source;
        if (!(expected.masterWeight === 0 && o.masterWeight === 0 && onOtherAccount)) fail(`${where}_unsafe_set_options`);
      }
      if (o.homeDomain !== expected.homeDomain) fail(`${where}_home_domain_mismatch`);
      if ((o.setFlags as number | undefined) !== expected.setFlags) fail(`${where}_flags_mismatch`);
      if ((o.clearFlags as number | undefined) !== expected.clearFlags) fail(`${where}_flags_mismatch`);
      return;
    }
    case "uploadContractWasm": {
      const fn = (op as Operation.InvokeHostFunction).func as unknown as { type: string; wasm?: Uint8Array };
      if (fn.type !== "hostFunctionTypeUploadContractWasm" || !(fn.wasm instanceof Uint8Array)) fail(`${where}_not_upload`);
      if (sha256HexSync(fn.wasm) !== expected.wasmHash.toLowerCase()) fail(`${where}_wasm_mismatch`);
      if (((op as Operation.InvokeHostFunction).auth ?? []).length > 0) fail(`${where}_unexpected_auth`);
      return;
    }
    case "createContract": {
      const o = op as Operation.InvokeHostFunction;
      const fn = o.func as unknown as { type: string; createContractV2?: {
        contractIdPreimage: { type: string; fromAddress?: { address: unknown; salt: unknown } };
        executable: { type: string; wasmHash?: unknown };
        constructorArgs: { toXDR: (f: "base64") => string }[] } };
      const c = fn.createContractV2;
      if (fn.type !== "hostFunctionTypeCreateContractV2" || !c) fail(`${where}_not_create_contract`);
      if (c.contractIdPreimage.type !== "contractIdPreimageFromAddress" || !c.contractIdPreimage.fromAddress) fail(`${where}_preimage_mismatch`);
      let deployer = "";
      try { deployer = Address.fromScAddress(c.contractIdPreimage.fromAddress.address as never).toString(); } catch { fail(`${where}_preimage_mismatch`); }
      if (deployer !== expected.deployer) fail(`${where}_deployer_mismatch`);
      if (bytesHex(c.contractIdPreimage.fromAddress.salt) !== expected.salt.toLowerCase()) fail(`${where}_salt_mismatch`);
      if (c.executable.type !== "contractExecutableWasm" || bytesHex(c.executable.wasmHash) !== expected.wasmHash.toLowerCase()) fail(`${where}_wasm_mismatch`);
      const args = (c.constructorArgs ?? []).map(a => a.toXDR("base64"));
      if (args.length !== expected.constructorArgs.length || args.some((a, i) => a !== expected.constructorArgs[i])) fail(`${where}_args_mismatch`);
      for (const entry of (o.auth ?? []) as unknown as { credentials: { type: string } }[]) {
        if (entry.credentials?.type !== "sorobanCredentialsSourceAccount") fail(`${where}_unexpected_auth`);
      }
      return;
    }
    case "invokeContract": {
      const o = op as Operation.InvokeHostFunction;
      const fn = o.func as unknown as { type: string; invokeContract?: { contractAddress: unknown; functionName: unknown; args?: { toXDR: (f: "base64") => string }[] } };
      if (fn.type !== "hostFunctionTypeInvokeContract" || !fn.invokeContract) fail(`${where}_not_contract_call`);
      let contract = "";
      try { contract = Address.fromScAddress(fn.invokeContract.contractAddress as never).toString(); } catch { fail(`${where}_contract_mismatch`); }
      if (contract !== expected.contractId) fail(`${where}_contract_mismatch`);
      if (String(fn.invokeContract.functionName) !== expected.functionName) fail(`${where}_function_mismatch`);
      if (expected.args) {
        const actual = (fn.invokeContract.args ?? []).map(a => a.toXDR("base64"));
        if (actual.length !== expected.args.length || actual.some((a, i) => a !== expected.args![i])) fail(`${where}_args_mismatch`);
      }
      // Authorisation entries must only cover the invoking account (source-account credentials).
      for (const entry of (o.auth ?? []) as unknown as { credentials: { type: string } }[]) {
        if (entry.credentials?.type !== "sorobanCredentialsSourceAccount") fail(`${where}_unexpected_auth`);
      }
      return;
    }
  }
}

function checkMemo(tx: Transaction, expected: SignIntent["memo"]) {
  const memo = tx.memo;
  const want = expected ?? { type: "none" as const };
  if (memo.type !== want.type) fail("memo_mismatch");
  if (want.type === "none") return;
  const raw = memo.value as unknown;
  const actual = raw === null || raw === undefined ? ""
    : raw instanceof Uint8Array ? Buffer.from(raw).toString(want.type === "hash" ? "hex" : "utf8")
    : String(raw);
  if (actual !== want.value) fail("memo_mismatch");
}

/**
 * Parses and validates an unsigned transaction envelope against the intent.
 * Returns the parsed Transaction ready to sign. Throws TxGuardError otherwise.
 */
export function guardTransaction(envelopeXdr: string, intent: SignIntent, now = Date.now()): Transaction {
  if (intent.networkPassphrase !== NEXORA_NETWORK_PASSPHRASE) fail("wrong_network");
  if (!StrKey.isValidEd25519PublicKey(intent.source)) fail("invalid_source");
  if (typeof envelopeXdr !== "string" || envelopeXdr.length === 0 || envelopeXdr.length > 200_000) fail("invalid_xdr");

  let parsed: Transaction | FeeBumpTransaction;
  try {
    parsed = TransactionBuilder.fromXDR(envelopeXdr, intent.networkPassphrase);
  } catch {
    fail("invalid_xdr");
  }
  if (parsed instanceof FeeBumpTransaction) fail("fee_bump_not_allowed");
  const tx = parsed as Transaction;

  // Integrity: the envelope must round-trip byte-for-byte and carry no signatures yet.
  if (tx.toEnvelope().toXDR("base64") !== envelopeXdr.trim()) fail("xdr_not_canonical");
  if (tx.signatures.length > 0) fail("already_signed");

  if (tx.source !== intent.source) fail("source_mismatch");
  if (tx.networkPassphrase !== intent.networkPassphrase) fail("wrong_network");

  const fee = BigInt(tx.fee);
  if (fee <= 0n || fee > BigInt(Math.floor(intent.maxFeeStroops))) fail("fee_too_high");

  const bounds = tx.timeBounds;
  if (!bounds) fail("missing_time_bounds");
  const maxTime = Number(bounds.maxTime);
  const nowSec = Math.floor(now / 1000);
  if (!maxTime) fail("unbounded_validity");
  if (maxTime < nowSec) fail("expired");
  if (maxTime - nowSec > (intent.maxValiditySeconds ?? 300)) fail("validity_too_long");

  checkMemo(tx, intent.memo);

  if (tx.operations.length === 0 || tx.operations.length !== intent.operations.length) fail("operation_count_mismatch");
  tx.operations.forEach((op, i) => checkOperation(op, intent.operations[i], intent.source, i));
  return tx;
}

/** Short user-facing text for a guard failure. Never includes XDR or key material. */
export function guardMessage(error: unknown): string {
  if (!(error instanceof TxGuardError)) return "This transaction could not be verified, so it was not signed.";
  if (error.reason === "expired" || error.reason === "validity_too_long") return "This transaction has expired. Review it again.";
  if (error.reason === "fee_too_high") return "The network fee changed. Review the transaction again.";
  return "This transaction did not match what you reviewed, so it was not signed.";
}
