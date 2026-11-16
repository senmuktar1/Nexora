import { HORIZON } from "@/lib/server/horizon";
import { safeError } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";
import {
  addOrderBookSelectors,
  isValidAssetPair,
  parseAssetSelector,
  parseNetwork,
  readLimit
} from "@/lib/stellar/horizon-market";

export const dynamic = "force-dynamic";

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

  const url = new URL(`${HORIZON}/order_book`);
  addOrderBookSelectors(url, base, counter);
  url.searchParams.set("limit", String(readLimit(params.get("limit"), 20, 200)));

  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      safeError(new Error("Upstream HTTP " + response.status + ": " + (await response.text()).slice(0, 600)), "stellar/orderbook");
      return NextResponse.json({ error: "Order book is temporarily unavailable." }, { status: 502 });
    }
    const orderBook = await response.json();
    return NextResponse.json({
      network,
      source: "Stellar Horizon /order_book",
      lastLedger: response.headers.get("X-Ledger"),
      base,
      counter,
      orderBook,
      retrievedAt: new Date().toISOString()
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      error: safeError(error, "stellar/orderbook")
    }, { status: 502 });
  }
}
