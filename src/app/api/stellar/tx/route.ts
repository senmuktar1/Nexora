import { NextRequest, NextResponse } from "next/server";
import { safeError } from "@/lib/server/errors";
import { HORIZON } from "@/lib/server/horizon";

export const dynamic = "force-dynamic";

/** Transaction receipt data from Horizon. The client decodes the envelope itself. */
export async function GET(request: NextRequest) {
  const hash = (request.nextUrl.searchParams.get("hash") ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) return NextResponse.json({ error: "Invalid transaction." }, { status: 400 });
  try {
    const response = await fetch(`${HORIZON}/transactions/${hash}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (response.status === 404) return NextResponse.json({ status: "not_found" });
    if (!response.ok) throw new Error("Horizon transactions HTTP " + response.status);
    const tx = await response.json() as Record<string, unknown>;
    return NextResponse.json({
      status: tx.successful === true ? "confirmed" : "failed",
      hash: tx.hash,
      ledger: tx.ledger,
      createdAt: tx.created_at,
      feeCharged: tx.fee_charged,
      envelopeXdr: tx.envelope_xdr
    }, { headers: { "Cache-Control": "public, s-maxage=300" } });
  } catch (error) {
    return NextResponse.json({ error: safeError(error, "stellar/tx") }, { status: 502 });
  }
}
