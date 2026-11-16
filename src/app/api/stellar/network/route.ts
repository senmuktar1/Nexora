import { HORIZON } from "@/lib/server/horizon";
import { safeError } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";


export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get("network") ?? "mainnet";
  if (requested !== "mainnet") {
    return NextResponse.json({ error: "Unsupported Stellar network." }, { status: 400 });
  }

  const base = HORIZON;
  try {
    const [ledgerResponse, rootResponse] = await Promise.all([
      fetch(`${base}/ledgers?order=desc&limit=1`, { cache: "no-store", signal: AbortSignal.timeout(8000) }),
      fetch(base, { cache: "no-store", signal: AbortSignal.timeout(8000) })
    ]);
    if (!ledgerResponse.ok || !rootResponse.ok) {
      return NextResponse.json({ online: false, network: requested, error: "Temporarily unavailable." }, { status: 502 });
    }
    const [ledgerData, rootData] = await Promise.all([ledgerResponse.json(), rootResponse.json()]);
    const ledger = ledgerData?._embedded?.records?.[0];
    return NextResponse.json({
      online: true,
      network: requested,
      latestLedger: typeof ledger?.sequence === "number" ? ledger.sequence : null,
      closedAt: typeof ledger?.closed_at === "string" ? ledger.closed_at : null,
      horizonVersion: typeof rootData?.horizon_version === "string" ? rootData.horizon_version : null,
      coreVersion: typeof rootData?.core_version === "string" ? rootData.core_version : null,
      retrievedAt: new Date().toISOString()
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      online: false,
      network: requested,
      error: safeError(error, "stellar/network")
    }, { status: 502 });
  }
}
