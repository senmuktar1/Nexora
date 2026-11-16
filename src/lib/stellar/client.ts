"use client";

import { Buffer } from "buffer";
import { Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import type { AccountState } from "./swap";
import { messageForCode } from "./submit-errors";

/** Client helpers shared by every module's transaction flow. Never surface server text. */

export class ClientError extends Error {
  constructor(public readonly code: "inactive" | "unavailable") { super(code); }
}

export async function loadAccount(address: string): Promise<AccountState> {
  const response = await fetch(`/api/stellar/account?network=mainnet&address=${encodeURIComponent(address)}`, { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (response.status === 404) throw new ClientError("inactive");
  if (!response.ok || !data?.account) throw new ClientError("unavailable");
  return {
    id: data.account.account_id,
    sequence: String(data.account.sequence),
    subentryCount: Number(data.account.subentry_count ?? 0),
    numSponsoring: Number(data.account.num_sponsoring ?? 0),
    numSponsored: Number(data.account.num_sponsored ?? 0),
    balances: data.balances ?? []
  };
}

export async function loadFeePerOperation(): Promise<number> {
  const response = await fetch("/api/stellar/fee", { cache: "no-store" });
  const data = response.ok ? await response.json().catch(() => null) : null;
  if (!data?.perOperation) throw new ClientError("unavailable");
  return Number(data.perOperation);
}

export function hashOf(signedXdr: string): string {
  return Buffer.from(TransactionBuilder.fromXDR(signedXdr, Networks.PUBLIC).hash()).toString("hex");
}

export type SubmitOutcome =
  | { status: "confirmed"; hash: string }
  | { status: "pending"; hash: string }
  | { status: "failed"; hash: string; message: string };

export type TxStatus = "confirmed" | "failed" | "not_found" | "unknown";

/** Reads a transaction's on-chain status via /api/stellar/tx. */
export async function fetchTxStatus(hash: string): Promise<TxStatus> {
  try {
    const response = await fetch(`/api/stellar/tx?hash=${hash}`, { cache: "no-store" });
    if (!response.ok) return "unknown";
    const data = await response.json();
    return data?.status === "confirmed" || data?.status === "failed" || data?.status === "not_found" ? data.status : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Relays a signed transaction and reports success only after ledger confirmation of the
 * same hash. If the server can't confirm quickly, polls from the browser (up to ~60 s).
 */
export async function submitSigned(signedXdr: string, opts: { pollMs?: number; maxPolls?: number } = {}): Promise<SubmitOutcome> {
  const hash = hashOf(signedXdr);
  try {
    const response = await fetch("/api/stellar/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ xdr: signedXdr }) });
    const result = await response.json().catch(() => null);
    if (result?.hash && result.hash !== hash) return { status: "failed", hash, message: "The network response didn't match this transaction. Check your activity before retrying." };
    if (result?.status === "confirmed") return { status: "confirmed", hash };
    if (result?.status === "failed") {
      // A bad-sequence rejection can mean this very transaction was already included (e.g. a retry).
      if (result.code === "tx_bad_seq" && (await fetchTxStatus(hash)) === "confirmed") return { status: "confirmed", hash };
      return { status: "failed", hash, message: messageForCode(result.code) };
    }
  } catch {
    // fall through to polling: the transaction may still have been relayed
  }
  const pollMs = opts.pollMs ?? 3000, maxPolls = opts.maxPolls ?? 20;
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(resolve => setTimeout(resolve, pollMs));
    const status = await fetchTxStatus(hash);
    if (status === "confirmed") return { status: "confirmed", hash };
    if (status === "failed") return { status: "failed", hash, message: "The transaction failed. No funds were moved." };
  }
  return { status: "pending", hash };
}

export function explorerTx(hash: string) {
  return `https://stellar.expert/explorer/public/tx/${hash}`;
}
