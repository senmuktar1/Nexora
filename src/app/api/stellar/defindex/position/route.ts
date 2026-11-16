import { NextRequest, NextResponse } from "next/server";
import { StrKey } from "@stellar/stellar-sdk";
import { logServerError, UNAVAILABLE } from "@/lib/server/errors";
import { rateLimited } from "@/lib/server/rate-limit";
import { ensureVerifiedMainnetRpc } from "@/lib/server/soroban";
import { assertListedVault, DefindexError, readVaultState } from "@/lib/server/defindex";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Soroban reads + simulation can exceed short serverless defaults; hosts that honour this get 30 s.
export const maxDuration = 30;
const NO_STORE = { "Cache-Control": "no-store" };

/** GET ?vault=C…[&wallet=G…][&shares=N] → vault assets, user shares/underlying, and amounts for N shares. */
export async function GET(request: NextRequest) {
  if (rateLimited(request, "defindex-position", 60)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const p = request.nextUrl.searchParams;
  const vault = p.get("vault") ?? "", wallet = p.get("wallet"), sharesRaw = p.get("shares");
  if (!StrKey.isValidContract(vault) || (wallet !== null && !StrKey.isValidEd25519PublicKey(wallet)) || (sharesRaw !== null && !/^\d{1,30}$/.test(sharesRaw))) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!(await ensureVerifiedMainnetRpc())) return NextResponse.json({ error: UNAVAILABLE, status: "soroban_unavailable" }, { status: 503, headers: NO_STORE });
  try {
    await assertListedVault(vault);
    const state = await readVaultState(vault, wallet, sharesRaw ? BigInt(sharesRaw) : null);
    return NextResponse.json({ ...state, retrievedAt: new Date().toISOString() }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof DefindexError && (error.code === "not_listed" || error.code === "not_a_vault")) return NextResponse.json({ error: "This vault isn't available." }, { status: 404, headers: NO_STORE });
    const requestId = logServerError("stellar/defindex/position", error);
    return NextResponse.json({ error: UNAVAILABLE, requestId }, { status: 502, headers: NO_STORE });
  }
}
