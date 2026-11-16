import { HORIZON } from "@/lib/server/horizon";
import { NextRequest, NextResponse } from "next/server";
import { safeError } from "@/lib/server/errors";
import { rateLimited } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const ASSET_ID = /^(native|[A-Za-z0-9]{1,12}:G[A-Z2-7]{55})$/;
const AMOUNT = /^\d{1,12}(\.\d{1,7})?$/;

type HorizonAsset = { asset_type: string; asset_code?: string; asset_issuer?: string };
const toId = (a: HorizonAsset) => a.asset_type === "native" ? "native" : `${a.asset_code}:${a.asset_issuer}`;

/** Strict-send quotes from Horizon's path finder (order books + AMM pools). */
export async function GET(request: NextRequest) {
  if (rateLimited(request, "paths", 60)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const params = request.nextUrl.searchParams;
  const sendAsset = params.get("sendAsset") ?? "";
  const destAsset = params.get("destAsset") ?? "";
  const sendAmount = params.get("sendAmount") ?? "";
  if (!ASSET_ID.test(sendAsset) || !ASSET_ID.test(destAsset) || sendAsset === destAsset || !AMOUNT.test(sendAmount) || Number(sendAmount) <= 0) {
    return NextResponse.json({ error: "Invalid swap parameters." }, { status: 400 });
  }
  const url = new URL(`${HORIZON}/paths/strict-send`);
  if (sendAsset === "native") url.searchParams.set("source_asset_type", "native");
  else {
    const [code, issuer] = sendAsset.split(":");
    url.searchParams.set("source_asset_type", code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12");
    url.searchParams.set("source_asset_code", code);
    url.searchParams.set("source_asset_issuer", issuer);
  }
  url.searchParams.set("source_amount", sendAmount);
  url.searchParams.set("destination_assets", destAsset);

  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("Horizon paths HTTP " + response.status);
    const data = await response.json() as { _embedded?: { records?: (HorizonAsset & Record<string, unknown>)[] } };
    const routes = (data._embedded?.records ?? [])
      .filter(r => toId({ asset_type: String(r.destination_asset_type), asset_code: r.destination_asset_code as string, asset_issuer: r.destination_asset_issuer as string }) === destAsset)
      .map(r => ({
        sendAmount: String(r.source_amount),
        destAmount: String(r.destination_amount),
        path: ((r.path as HorizonAsset[]) ?? []).map(toId)
      }))
      .sort((a, b) => Number(b.destAmount) - Number(a.destAmount));
    return NextResponse.json({ sendAsset, destAsset, routes, source: "Stellar Horizon", retrievedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: safeError(error, "stellar/paths") }, { status: 502 });
  }
}
