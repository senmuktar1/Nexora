import { HORIZON } from "@/lib/server/horizon";
import { NextResponse } from "next/server";
import { safeError } from "@/lib/server/errors";

export const dynamic = "force-dynamic";

const MAX_FEE_PER_OP = 10_000; // 0.001 XLM hard cap per operation

/** Recommended per-operation inclusion fee (stroops), from recent ledger fee stats. */
export async function GET() {
  try {
    const response = await fetch(`${HORIZON}/fee_stats`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("Horizon fee_stats HTTP " + response.status);
    const stats = await response.json() as { last_ledger_base_fee?: string; fee_charged?: { p70?: string } };
    const base = Number(stats.last_ledger_base_fee ?? 100);
    const p70 = Number(stats.fee_charged?.p70 ?? base);
    const perOp = Math.min(Math.max(base, Number.isFinite(p70) ? p70 : base), MAX_FEE_PER_OP);
    return NextResponse.json({ perOperation: perOp, baseFee: base, maxPerOperation: MAX_FEE_PER_OP }, { headers: { "Cache-Control": "public, s-maxage=10" } });
  } catch (error) {
    return NextResponse.json({ error: safeError(error, "stellar/fee") }, { status: 502 });
  }
}
