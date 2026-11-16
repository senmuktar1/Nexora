import { HORIZON } from "@/lib/server/horizon";
import { safeError } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";


export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = (request.nextUrl.searchParams.get("code") ?? "").trim();
  const issuer = (request.nextUrl.searchParams.get("issuer") ?? "").trim();
  const requested = request.nextUrl.searchParams.get("network") ?? "mainnet";
  if (requested !== "mainnet") {
    return NextResponse.json({ error: "Unsupported Stellar network." }, { status: 400 });
  }
  if (code.length < 2 || code.length > 12 || !/^[a-zA-Z0-9._-]+$/.test(code)) {
    return NextResponse.json({ error: "Enter an asset code between 2 and 12 valid characters." }, { status: 400 });
  }
  if (issuer && !/^G[A-Z2-7]{55}$/.test(issuer)) {
    return NextResponse.json({ error: "Enter a valid Stellar issuer public key." }, { status: 400 });
  }

  const url = new URL(`${HORIZON}/assets`);
  url.searchParams.set("asset_code", code.toUpperCase());
  if (issuer) url.searchParams.set("asset_issuer", issuer);
  url.searchParams.set("limit", "20");
  url.searchParams.set("order", "desc");

  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) return NextResponse.json({ error: "Search is temporarily unavailable." }, { status: 502 });
    const data = await response.json();
    const assets = (data?._embedded?.records ?? []).map((asset: Record<string, unknown>) => ({
      asset_code: typeof asset.asset_code === "string" ? asset.asset_code : "",
      asset_issuer: typeof asset.asset_issuer === "string" ? asset.asset_issuer : "",
      num_accounts: typeof asset.num_accounts === "string" ? asset.num_accounts : undefined,
      amount: typeof asset.amount === "string" ? asset.amount : undefined,
      auth_required: typeof asset.auth_required === "boolean" ? asset.auth_required : undefined,
      auth_revocable: typeof asset.auth_revocable === "boolean" ? asset.auth_revocable : undefined,
      auth_immutable: typeof asset.auth_immutable === "boolean" ? asset.auth_immutable : undefined
    })).filter((asset: { asset_code: string; asset_issuer: string }) => asset.asset_code && asset.asset_issuer);

    return NextResponse.json({ network: requested, query: code.toUpperCase(), assets, retrievedAt: new Date().toISOString() }, {
      headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" }
    });
  } catch (error) {
    return NextResponse.json({ error: safeError(error, "stellar/assets") }, { status: 502 });
  }
}
