import { Account, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { NEXORA_NETWORK_PASSPHRASE, parseAssetId, toStroops, type AssetId, type ExpectedOperation, type SignIntent } from "./tx-guard";

export const BASE_RESERVE_STROOPS = 5_000_000n; // 0.5 XLM
export const TX_VALIDITY_SECONDS = 180;
/** Client-side ceiling on the per-operation fee, regardless of what the server suggests. */
export const MAX_FEE_PER_OPERATION = 10_000;

export type AccountBalance = {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  selling_liabilities?: string;
};

export type AccountState = {
  id: string;
  sequence: string;
  subentryCount: number;
  numSponsoring: number;
  numSponsored: number;
  balances: AccountBalance[];
};

export function fromStroops(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 10_000_000n;
  const frac = (abs % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

export function balanceAssetId(b: AccountBalance): AssetId | null {
  if (b.asset_type === "native") return "native";
  if (b.asset_type === "credit_alphanum4" || b.asset_type === "credit_alphanum12") return `${b.asset_code}:${b.asset_issuer}`;
  return null; // liquidity pool shares are not swappable assets
}

export function hasTrustline(account: AccountState, asset: AssetId) {
  return asset === "native" || account.balances.some(b => balanceAssetId(b) === asset);
}

/** Minimum XLM the account must keep: (2 + subentries + sponsoring − sponsored) × base reserve. */
export function minimumBalanceStroops(account: AccountState, extraSubentries = 0): bigint {
  const entries = 2n + BigInt(account.subentryCount + extraSubentries + account.numSponsoring - account.numSponsored);
  return entries * BASE_RESERVE_STROOPS;
}

/** Amount of `asset` the account can spend now, after reserves and open-offer liabilities. */
export function spendableStroops(account: AccountState, asset: AssetId, extraSubentries = 0, feeStroops = 0n): bigint {
  const line = account.balances.find(b => balanceAssetId(b) === asset);
  if (!line) return 0n;
  let available = toStroops(line.balance) - toStroops(line.selling_liabilities ?? "0");
  if (asset === "native") available -= minimumBalanceStroops(account, extraSubentries) + feeStroops;
  return available > 0n ? available : 0n;
}

export type SwapRequest = {
  account: AccountState;
  sendAsset: AssetId;
  sendAmount: string;
  destAsset: AssetId;
  quotedDestAmount: string;
  path: AssetId[];
  slippageBps: number;
  feePerOperation: number;
  now?: number;
};

export type SwapPlan = {
  xdr: string;
  intent: Omit<SignIntent, "source">;
  review: {
    send: string;
    sendAsset: AssetId;
    expected: string;
    minimumReceived: string;
    destAsset: AssetId;
    addsTrustline: boolean;
    networkFee: string;
    validUntil: number;
  };
};

export class SwapError extends Error {
  constructor(public readonly code: "invalid_amount" | "same_asset" | "insufficient_balance" | "invalid_slippage" | "no_route" | "invalid_fee") {
    super(code);
  }
}

/** Builds an unsigned strict-send swap to self, plus the matching sign intent. */
export function buildSwap(req: SwapRequest): SwapPlan {
  if (req.sendAsset === req.destAsset) throw new SwapError("same_asset");
  if (!Number.isInteger(req.slippageBps) || req.slippageBps < 1 || req.slippageBps > 1000) throw new SwapError("invalid_slippage");
  let send: bigint, quoted: bigint;
  try {
    send = toStroops(req.sendAmount);
    quoted = toStroops(req.quotedDestAmount);
  } catch {
    throw new SwapError("invalid_amount");
  }
  if (send <= 0n) throw new SwapError("invalid_amount");
  if (quoted <= 0n) throw new SwapError("no_route");

  if (!Number.isFinite(req.feePerOperation) || req.feePerOperation < 100 || req.feePerOperation > MAX_FEE_PER_OPERATION) throw new SwapError("invalid_fee");
  const addsTrustline = !hasTrustline(req.account, req.destAsset);
  const opCount = addsTrustline ? 2 : 1;
  const fee = BigInt(Math.ceil(req.feePerOperation)) * BigInt(opCount);
  if (send > spendableStroops(req.account, req.sendAsset, addsTrustline ? 1 : 0, req.sendAsset === "native" ? fee : 0n)) {
    throw new SwapError("insufficient_balance");
  }
  if (req.sendAsset !== "native" && spendableStroops(req.account, "native", addsTrustline ? 1 : 0, fee) < 0n) {
    throw new SwapError("insufficient_balance");
  }

  const minReceived = (quoted * BigInt(10_000 - req.slippageBps)) / 10_000n;
  if (minReceived <= 0n) throw new SwapError("no_route");
  const nowSec = Math.floor((req.now ?? Date.now()) / 1000);
  const validUntil = nowSec + TX_VALIDITY_SECONDS;

  const builder = new TransactionBuilder(new Account(req.account.id, req.account.sequence), {
    fee: String(req.feePerOperation),
    networkPassphrase: NEXORA_NETWORK_PASSPHRASE,
    timebounds: { minTime: 0, maxTime: validUntil }
  });
  const operations: ExpectedOperation[] = [];
  if (addsTrustline) {
    builder.addOperation(Operation.changeTrust({ asset: parseAssetId(req.destAsset) }));
    operations.push({ type: "changeTrust", asset: req.destAsset });
  }
  builder.addOperation(Operation.pathPaymentStrictSend({
    sendAsset: parseAssetId(req.sendAsset),
    sendAmount: fromStroops(send),
    destination: req.account.id,
    destAsset: parseAssetId(req.destAsset),
    destMin: fromStroops(minReceived),
    path: req.path.map(parseAssetId)
  }));
  operations.push({
    type: "pathPaymentStrictSend",
    sendAsset: req.sendAsset,
    sendAmount: fromStroops(send),
    destination: req.account.id,
    destAsset: req.destAsset,
    destMin: fromStroops(minReceived)
  });

  return {
    xdr: builder.build().toEnvelope().toXDR("base64"),
    intent: {
      networkPassphrase: NEXORA_NETWORK_PASSPHRASE,
      operations,
      maxFeeStroops: Number(fee),
      maxValiditySeconds: TX_VALIDITY_SECONDS + 5
    },
    review: {
      send: fromStroops(send),
      sendAsset: req.sendAsset,
      expected: fromStroops(quoted),
      minimumReceived: fromStroops(minReceived),
      destAsset: req.destAsset,
      addsTrustline,
      networkFee: fromStroops(fee),
      validUntil
    }
  };
}
