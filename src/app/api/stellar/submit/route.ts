import { HORIZON } from "@/lib/server/horizon";
import { NextRequest, NextResponse } from "next/server";
import { FeeBumpTransaction, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { logServerError, UNAVAILABLE } from "@/lib/server/errors";
import { rateLimited } from "@/lib/server/rate-limit";
import { describeResultCodes } from "@/lib/stellar/submit-errors";
import { verifyTransactionSignatures } from "@/lib/stellar/verify-signed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const DEDUPE_MS = 10 * 60_000;
/** Recent outcomes by transaction hash (per server instance). */
const recentSubmissions = new Map<string, { at: number; status: "pending" | "confirmed" | "failed"; code?: string }>();
function remember(hash: string, v: { status: "pending" | "confirmed" | "failed"; code?: string }) {
  recentSubmissions.set(hash, { at: Date.now(), ...v });
  if (recentSubmissions.size > 5_000) for (const [k, e] of recentSubmissions) if (Date.now() - e.at > DEDUPE_MS) recentSubmissions.delete(k);
}
/** Test hook. */
export function __resetSubmissionsForTests() { recentSubmissions.clear(); }
const SUBMIT_TIMEOUT_MS = 8_000;
export const maxDuration = 15;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * Relays a locally signed Mainnet transaction to Horizon and confirms it.
 * The server never sees keys; it only checks the envelope is a signed Mainnet
 * transaction and reports the confirmed result. It never reports success
 * without a ledger confirmation.
 */
export async function POST(request: NextRequest) {
  if (rateLimited(request, "submit", 12)) return json({ error: "Too many requests. Wait a moment and try again." }, 429);

  let envelope = "";
  try {
    const body = await request.json() as { xdr?: unknown };
    envelope = typeof body.xdr === "string" ? body.xdr.trim() : "";
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  // Soroban contract uploads can approach the network's ~128 KB transaction limit (base64 ≈ 172 KB).
  if (!envelope || envelope.length > 180_000) return json({ error: "Invalid request." }, 400);

  let hash: string;
  try {
    const tx = TransactionBuilder.fromXDR(envelope, Networks.PUBLIC);
    if (tx instanceof FeeBumpTransaction) return json({ error: "Invalid request." }, 400);
    if (!verifyTransactionSignatures(tx)) return json({ error: "Invalid request." }, 400);
    hash = Buffer.from(tx.hash()).toString("hex");
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  // Duplicate submission (retry, double click, second tab): never re-send; report the known outcome.
  const previous = recentSubmissions.get(hash);
  if (previous && Date.now() - previous.at < DEDUPE_MS) {
    if (previous.status === "confirmed") return json({ status: "confirmed", hash, duplicate: true });
    if (previous.status === "failed") return json({ status: "failed", hash, code: previous.code, duplicate: true });
    return json({ status: "pending", hash, duplicate: true }, 202);
  }
  remember(hash, { status: "pending" });

  // Horizon normally answers within one ledger (~5-6 s). Keep this route short so it fits
  // serverless function limits; if the outcome isn't known yet, the client polls /api/stellar/tx.
  let response: Response;
  try {
    response = await fetch(`${HORIZON}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ tx: envelope }).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS)
    });
  } catch (error) {
    // Timed out or network error: the transaction may still be included.
    logServerError("stellar/submit:timeout", error);
    return json({ status: "pending", hash }, 202);
  }
  try {
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (response.ok && payload && payload.successful === true) {
      remember(hash, { status: "confirmed" });
      return json({ status: "confirmed", hash, ledger: payload.ledger ?? null });
    }
    if (response.status === 400 && payload) {
      const extras = payload.extras as { result_codes?: { transaction?: string; operations?: string[] } } | undefined;
      const failure = describeResultCodes(extras?.result_codes);
      logServerError("stellar/submit:rejected", new Error(JSON.stringify(extras?.result_codes ?? {})));
      // tx_bad_seq may mean this exact transaction already succeeded: let the client check the ledger.
      if (failure.code === "tx_bad_seq") { recentSubmissions.delete(hash); return json({ status: "failed", hash, code: failure.code, error: failure.message, checkLedger: true }, 200); }
      remember(hash, { status: "failed", code: failure.code });
      return json({ status: "failed", hash, code: failure.code, error: failure.message }, 200);
    }
    // 504 (Horizon gave up waiting) or other transient status: outcome unknown, client polls.
    logServerError("stellar/submit:unconfirmed", new Error("Horizon HTTP " + response.status));
    return json({ status: "pending", hash }, 202);
  } catch (error) {
    const requestId = logServerError("stellar/submit", error);
    return json({ status: "pending", hash, error: UNAVAILABLE, requestId }, 202);
  }
}
