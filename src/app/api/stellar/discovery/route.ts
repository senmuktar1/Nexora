import { safeError } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Network = "testnet" | "mainnet";
type Category = "trending" | "gainers" | "new";

const API = "https://api.stellar.expert";
const networkPath: Record<Network, string> = { testnet: "testnet", mainnet: "public" };

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function priceChange7d(value: unknown): number | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const points = value.map((point) => Array.isArray(point) ? finiteNumber(point[1]) : null)
    .filter((point): point is number => point !== null && point > 0);
  if (points.length < 2) return null;
  return ((points[points.length - 1] - points[0]) / points[0]) * 100;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const network = params.get("network") as Network | null;
  const category = params.get("category") as Category | null;
  if (network !== "mainnet") {
    return NextResponse.json({ error: "Network must be testnet or mainnet." }, { status: 400 });
  }
  if (category !== "trending" && category !== "gainers" && category !== "new") {
    return NextResponse.json({ error: "Unsupported discovery category." }, { status: 400 });
  }

  const key = process.env.STELLAR_EXPERT_API_KEY;
  const headers: HeadersInit = key ? { Authorization: "Bearer " + key } : {};
  const base = API + "/explorer/" + networkPath[network];
  let url: string;
  let source: string;
  let rankingBasis: string;
  let notice: string | null = null;
  let mode: "markets" | "assets" | "top50";

  if (network === "mainnet" && !key) {
    if (category !== "trending") {
      return NextResponse.json({
        network, category, records: [], source: "StellarExpert API",
        status: "api_key_required",
        error: null
      }, { status: 200, headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } });
    }
    url = API + "/explorer/public/asset-list/top50";
    source = "StellarExpert Top 50";
    rankingBasis = "Technical asset metrics including payments, trading volume, interoperability and userbase. Not an endorsement or verification.";
    notice = "StellarExpert's free Mainnet top-50 list is a technical-metrics discovery list, not a real-time price or liquidity ranking.";
    mode = "top50";
  } else if (category === "trending") {
    url = base + "/market?limit=25";
    source = "StellarExpert indexed Stellar markets";
    rankingBasis = "Indexed market activity; the API's market-list ordering.";
    mode = "markets";
  } else {
    const sort = category === "gainers" ? "volume7d" : "created";
    url = base + "/asset?sort=" + sort + "&order=desc&limit=25";
    source = "StellarExpert indexed asset directory";
    rankingBasis = category === "gainers"
      ? "Assets sorted by indexed 7-day volume; 7-day price change is calculated only when the source supplies a valid price series."
      : "Most recently created assets according to the indexer's creation timestamp.";
    mode = "assets";
  }

  try {
    const response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      const detail = safeError(new Error("StellarExpert HTTP " + response.status), "stellar/discovery");
      return NextResponse.json({
        network, category, records: [], source, status: response.status === 402 ? "api_key_required" : "upstream_error",
        error: detail,
        retryAfter: response.headers.get("Retry-After")
      }, { status: 200, headers: { "Cache-Control": "no-store" } });
    }

    const data = await response.json();
    const rawRecords: Record<string, unknown>[] = mode === "top50"
      ? (Array.isArray(data?.assets) ? data.assets : [])
      : (Array.isArray(data?._embedded?.records) ? data._embedded.records : []);

    const records = rawRecords.map((item) => {
      if (mode === "markets") {
        const pair = Array.isArray(item.asset) ? item.asset : [];
        return {
          kind: "market",
          id: pair.map((value) => String(value)).join("/"),
          assets: pair.map((value) => String(value)),
          trades24h: finiteNumber(item.trades24h),
          baseVolume24h: finiteNumber(item.base_volume24h),
          price7d: Array.isArray(item.price7d) ? item.price7d : null,
          sourceUpdatedAt: finiteNumber(item.ts) ?? finiteNumber(item.updated)
        };
      }
      const code = typeof item.code === "string" ? item.code : null;
      const issuer = typeof item.issuer === "string" ? item.issuer : null;
      const priceSeries = Array.isArray(item.price7d) ? item.price7d : null;
      return {
        kind: "asset",
        code,
        issuer,
        contract: typeof item.contract === "string" ? item.contract : null,
        name: typeof item.name === "string" ? item.name : code,
        organization: typeof item.org === "string" ? item.org : null,
        domain: typeof item.domain === "string" ? item.domain : null,
        icon: typeof item.icon === "string" ? item.icon : null,
        supply: finiteNumber(item.supply),
        priceUsd: finiteNumber(item.price),
        volume7d: finiteNumber(item.volume7d),
        trades: finiteNumber(item.trades),
        holders: finiteNumber(item.trustlines),
        createdAt: finiteNumber(item.created),
        change7d: priceChange7d(priceSeries),
        price7d: priceSeries
      };
    }).filter((item) => mode === "markets"
      ? Boolean((item as { id: string }).id)
      : Boolean((item as { code: string | null; issuer: string | null }).code && (item as { issuer: string | null }).issuer));

    return NextResponse.json({
      network, category, source, rankingBasis, notice,
      status: records.length ? "available" : "no_data",
      records, retrievedAt: new Date().toISOString(),
      next: data?._links?.next?.href ?? null
    }, { headers: { "Cache-Control": network === "mainnet" ? "public, s-maxage=60, stale-while-revalidate=120" : "public, s-maxage=30, stale-while-revalidate=60" } });
  } catch (error) {
    return NextResponse.json({
      network, category, records: [], source: "StellarExpert",
      status: "upstream_error",
      error: safeError(error, "stellar/discovery")
    }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
