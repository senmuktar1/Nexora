import { safeError } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

type Network = "testnet" | "mainnet";
type UnknownRecord = Record<string, unknown>;
type DirectoryAsset = { rank:number; assetCode:string; issuer:string; holders:number|null; supply:string|null; domain:string|null; price:number|null; change24h:number|null; volume24h:number|null; marketCap:number|null };

const API = "https://api.stellar.expert/explorer";
export const dynamic = "force-dynamic";

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}
function firstString(source: UnknownRecord, keys: string[]): string | null {
  for (const key of keys) if (typeof source[key] === "string" && source[key]) return source[key] as string;
  return null;
}
function firstNumber(source: UnknownRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

export async function GET(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get("network") ?? "mainnet";
  if (requested !== "mainnet") {
    return NextResponse.json({ error: "Network must be testnet or mainnet." }, { status: 400 });
  }
  const network: Network = requested;
  const url = API + "/" + (network === "mainnet" ? "public" : "testnet") + "/asset-list/top50";
  const headers = new Headers({ Accept: "application/json" });
  const apiKey = process.env.STELLAR_EXPERT_API_KEY;
  if (apiKey) headers.set("Authorization", "Bearer " + apiKey);

  try {
    const response = await fetch(url, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      safeError(new Error("Upstream HTTP " + response.status + ": " + (await response.text()).slice(0, 400)), "stellar/intelligence");
      return NextResponse.json({
        error: "Temporarily unavailable.",
        provider: "StellarExpert",
        network
      }, { status: 502 });
    }
    const payload: unknown = await response.json();
    const root = record(payload);
    const embedded = record(root._embedded);
    const rawAssets = Array.isArray(payload) ? payload : Array.isArray(root.records) ? root.records : Array.isArray(embedded.records) ? embedded.records : [];
    const assets: DirectoryAsset[] = [];
    for (const [index, item] of rawAssets.entries()) {
      const asset = record(item);
      const identity = record(asset.asset);
      const assetIdentifier = typeof asset.asset === "string" ? asset.asset : "";
      const parsedIdentifier = assetIdentifier.match(/^(.+)-(G[A-Z2-7]{55})-([12])$/);
      const code = firstString(asset, ["asset_code", "code", "assetCode", "symbol"]) ??
        firstString(identity, ["asset_code", "code", "assetCode", "symbol"]) ?? parsedIdentifier?.[1] ?? null;
      const issuer = firstString(asset, ["asset_issuer", "issuer", "assetIssuer"]) ??
        firstString(identity, ["asset_issuer", "issuer", "assetIssuer"]) ?? parsedIdentifier?.[2] ?? null;
      if (!code || !issuer) continue;
      assets.push({
        rank: firstNumber(asset, ["rank", "position"]) ?? index + 1,
        assetCode: code,
        issuer,
        holders: firstNumber(asset, ["num_accounts", "holders", "accounts", "holder_count"]),
        supply: firstString(asset, ["amount", "supply", "total_supply"]),
        domain: firstString(asset, ["domain", "issuer_domain"]),
        price: firstNumber(asset, ["price", "price_usd", "priceUsd"]),
        change24h: firstNumber(asset, ["change24h", "change_24h", "price_change_24h"]),
        volume24h: firstNumber(asset, ["volume24h", "volume_24h", "trade_volume_24h"]),
        marketCap: firstNumber(asset, ["marketCap", "market_cap", "marketcap"])
      });
    }

    return NextResponse.json({
      network,
      provider: "StellarExpert",
      source: url,
      dataset: "Top 50 asset directory",
      rankingMeaning: "Provider directory order; not a verified price, market-cap, volume or performance ranking.",
      assets,
      retrievedAt: new Date().toISOString(),
      cacheStatus: "live upstream response"
    }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } });
  } catch (error) {
    return NextResponse.json({
      error: safeError(error, "stellar/intelligence"),
      provider: "StellarExpert",
      network
    }, { status: 502 });
  }
}
