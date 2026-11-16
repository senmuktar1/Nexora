import { Account, Memo, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { NEXORA_NETWORK_PASSPHRASE, parseAssetId, toStroops, type AssetId, type SignIntent } from "./tx-guard";
import { fromStroops, hasTrustline, spendableStroops, MAX_FEE_PER_OPERATION, type AccountState } from "./swap";

export class PaymentError extends Error {
  constructor(public readonly code: "invalid_amount" | "self" | "insufficient_balance" | "no_trustline" | "inactive_needs_xlm" | "min_create" | "memo_too_long" | "invalid_fee") { super(code); }
}

/**
 * Builds a payment. If the recipient account doesn't exist yet and the asset is XLM,
 * it becomes a createAccount (minimum 1 XLM). Issued assets require an existing trustline.
 */
export function buildPayment(req: {
  sender: AccountState;
  recipient: AccountState | null;
  recipientId: string;
  asset: AssetId;
  amount: string;
  memo?: string;
  feePerOperation: number;
  now?: number;
}) {
  if (!Number.isFinite(req.feePerOperation) || req.feePerOperation < 100 || req.feePerOperation > MAX_FEE_PER_OPERATION) throw new PaymentError("invalid_fee");
  if (req.recipientId === req.sender.id) throw new PaymentError("self");
  let value: bigint;
  try { value = toStroops(req.amount); } catch { throw new PaymentError("invalid_amount"); }
  if (value <= 0n) throw new PaymentError("invalid_amount");
  const memo = (req.memo ?? "").trim();
  if (new TextEncoder().encode(memo).length > 28) throw new PaymentError("memo_too_long");
  const fee = BigInt(req.feePerOperation);
  const create = req.recipient === null;
  if (create && req.asset !== "native") throw new PaymentError("inactive_needs_xlm");
  if (create && value < 10_000_000n) throw new PaymentError("min_create");
  if (!create && req.asset !== "native" && !hasTrustline(req.recipient!, req.asset)) throw new PaymentError("no_trustline");
  if (spendableStroops(req.sender, req.asset, 0, req.asset === "native" ? fee : 0n) < value) throw new PaymentError("insufficient_balance");

  const nowSec = Math.floor((req.now ?? Date.now()) / 1000);
  const amount = fromStroops(value);
  const b = new TransactionBuilder(new Account(req.sender.id, req.sender.sequence), {
    fee: String(req.feePerOperation), networkPassphrase: NEXORA_NETWORK_PASSPHRASE, timebounds: { minTime: 0, maxTime: nowSec + 180 },
    memo: memo ? Memo.text(memo) : undefined
  });
  b.addOperation(create
    ? Operation.createAccount({ destination: req.recipientId, startingBalance: amount })
    : Operation.payment({ destination: req.recipientId, asset: parseAssetId(req.asset), amount }));
  const intent: Omit<SignIntent, "source"> = {
    networkPassphrase: NEXORA_NETWORK_PASSPHRASE,
    operations: [create ? { type: "createAccount", destination: req.recipientId, startingBalance: amount } : { type: "payment", destination: req.recipientId, asset: req.asset, amount }],
    maxFeeStroops: Number(fee),
    maxValiditySeconds: 185,
    memo: memo ? { type: "text", value: memo } : { type: "none" }
  };
  return { xdr: b.build().toEnvelope().toXDR("base64"), intent, amount, creates: create };
}
