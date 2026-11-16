/**
 * Maps Horizon transaction result codes to short, actionable user messages.
 * Raw codes are logged server-side only.
 */
export type SubmitFailure = { code: string; message: string };

const OP_MESSAGES: Record<string, string> = {
  op_underfunded: "Insufficient balance.",
  op_low_reserve: "Not enough XLM to cover the account reserve.",
  op_no_trust: "The recipient can't hold this asset yet.",
  op_line_full: "The recipient can't receive more of this asset.",
  op_no_destination: "The destination account doesn't exist.",
  op_under_dest_min: "The price moved beyond your slippage limit. Review the swap again.",
  op_over_source_max: "The price moved beyond your slippage limit. Review the swap again.",
  op_too_few_offers: "Not enough liquidity for this trade right now.",
  op_not_authorized: "The issuer hasn't authorised this account for the asset.",
  op_src_not_authorized: "The issuer hasn't authorised this account for the asset.",
  op_does_not_exist: "This item no longer exists or was already claimed.",
  op_cannot_claim: "This voucher can't be claimed by this account, or it has expired.",
  op_already_exists: "This already exists."
};

const TX_MESSAGES: Record<string, string> = {
  tx_bad_seq: "Your account changed. Review the transaction again.",
  tx_too_late: "This transaction expired. Review it again.",
  tx_insufficient_fee: "The network is busy. Try again.",
  tx_insufficient_balance: "Not enough XLM to pay the network fee.",
  tx_no_source_account: "This account isn't active yet.",
  tx_bad_auth: "This transaction wasn't authorised by the wallet."
};

export function describeResultCodes(codes: { transaction?: string; operations?: string[] } | null | undefined): SubmitFailure {
  for (const op of codes?.operations ?? []) {
    if (op !== "op_success" && OP_MESSAGES[op]) return { code: op, message: OP_MESSAGES[op] };
  }
  const tx = codes?.transaction ?? "unknown";
  return { code: tx, message: TX_MESSAGES[tx] ?? "The transaction failed. No funds were moved." };
}

/** Client-side message for a result code returned by /api/stellar/submit. */
export function messageForCode(code: unknown): string {
  if (typeof code !== "string") return "The transaction failed. No funds were moved.";
  return OP_MESSAGES[code] ?? TX_MESSAGES[code] ?? "The transaction failed. No funds were moved.";
}
