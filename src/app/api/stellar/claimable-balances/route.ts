import { NextRequest, NextResponse } from "next/server";
import { safeError } from "@/lib/server/errors";
import { HORIZON, normaliseClaimableBalance } from "@/lib/server/horizon";
import { rateLimited } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET ?id=<balance id>            → one claimable balance, or { status: "not_found" } (claimed/refunded/never existed)
 * GET ?claimant=<G address>       → balances where the address is a claimant (voucher creator view)
 */
export async function GET(request: NextRequest) {
  if (rateLimited(request, "claimable", 60)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const id = (request.nextUrl.searchParams.get("id") ?? "").trim().toLowerCase();
  const claimant = (request.nextUrl.searchParams.get("claimant") ?? "").trim();
  try {
    if (id) {
      if (!/^[0-9a-f]{72}$/.test(id)) return NextResponse.json({ error: "Invalid voucher." }, { status: 400 });
      const response = await fetch(`${HORIZON}/claimable_balances/${id}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (response.status === 404) return NextResponse.json({ status: "not_found" }, { headers: NO_STORE });
      if (!response.ok) throw new Error("Horizon claimable_balances HTTP " + response.status);
      const balance = normaliseClaimableBalance(await response.json());
      if (!balance) throw new Error("Unrecognised claimable balance record");
      return NextResponse.json({ status: "open", balance, retrievedAt: new Date().toISOString() }, { headers: NO_STORE });
    }
    if (!/^G[A-Z2-7]{55}$/.test(claimant)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const response = await fetch(`${HORIZON}/claimable_balances?claimant=${claimant}&limit=200&order=desc`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("Horizon claimable_balances list HTTP " + response.status);
    const data = await response.json() as { _embedded?: { records?: Record<string, unknown>[] } };
    const balances = (data._embedded?.records ?? []).map(normaliseClaimableBalance).filter(Boolean);
    return NextResponse.json({ balances, retrievedAt: new Date().toISOString() }, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json({ error: safeError(error, "stellar/claimable-balances") }, { status: 502 });
  }
}
