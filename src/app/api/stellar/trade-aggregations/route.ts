import { HORIZON } from "@/lib/server/horizon";
import { safeError } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";
import {
  addAssetSelector,
  isValidAssetPair,
  parseAssetSelector,
  parseNetwork,
  readLimit
} from "@/lib/stellar/horizon-market";

export const dynamic = "force-dynamic";

const ALLOWED_RESOLUTIONS = new Set([60_000, 300_000, 900_000, 3_600_000, 86_400_000]);
const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const network = parseNetwork(params.get("network"));
  if (!network) {
    return NextResponse.json({ error: "Network must be testnet or mainnet." }, { status: 400 });
  }

  const base = parseAssetSelector(params, "base");
  const counter = parseAssetSelector(params, "counter");
  if (!base || !counter || !isValidAssetPair(base, counter)) {
    return NextResponse.json({
      error: "Provide a valid, distinct asset pair. Issued assets require both asset code and issuer account; omit both to select native XLM."
    }, { status: 400 });
  }

  const now = Date.now();
  const endTime = Number(params.get("endTime") ?? now);
  const startTime = Number(params.get("startTime") ?? endTime - 24 * 60 * 60 * 1000);
  const resolution = Number(params.get("resolution") ?? 300_000);
  const limit = readLimit(params.get("limit"), 200, 200);

  if (
    !Number.isSafeInteger(startTime) ||
    !Number.isSafeInteger(endTime) ||
    endTime <= startTime ||
    endTime > now + 60_000 ||
    endTime - startTime > MAX_RANGE_MS ||
    !ALLOWED_RESOLUTIONS.has(resolution)
  ) {
    return NextResponse.json({
      error: "Invalid aggregation window. Use millisecond timestamps, a range up to 90 days, and a supported resolution: 1m, 5m, 15m, 1h or 1d."
    }, { status: 400 });
  }

  const url = new URL(`${HORIZON}/trade_aggregations`);
  addAssetSelector(url, "base", base);
  addAssetSelector(url, "counter", counter);
  url.searchParams.set("start_time", String(startTime));
  url.searchParams.set("end_time", String(endTime));
  url.searchParams.set("resolution", String(resolution));
  url.searchParams.set("order", "asc");
  url.searchParams.set("limit", String(limit));

  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      safeError(new Error("Upstream HTTP " + response.status + ": " + (await response.text()).slice(0, 600)), "stellar/trade-aggregations");
      return NextResponse.json({ error: "Price history is temporarily unavailable." }, { status: 502 });
    }
    const data = await response.json();
    return NextResponse.json({
      network,
      source: "Stellar Horizon /trade_aggregations",
      lastLedger: response.headers.get("X-Ledger"),
      base,
      counter,
      startTime,
      endTime,
      resolution,
      aggregations: data?._embedded?.records ?? [],
      paging: data?._links?.next?.href ?? null,
      retrievedAt: new Date().toISOString()
    }, { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" } });
  } catch (error) {
    return NextResponse.json({
      error: safeError(error, "stellar/trade-aggregations")
    }, { status: 502 });
  }
}
