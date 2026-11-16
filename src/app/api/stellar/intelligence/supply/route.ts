import { safeError } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function formatStroops(value: string): string | null {
  if (!/^\d+$/.test(value)) return null;
  const padded = value.padStart(8, "0");
  const whole = padded.slice(0, -7).replace(/^0+(?=\d)/, "");
  const fraction = padded.slice(-7).replace(/0+$/, "");
  return fraction ? whole + "." + fraction : whole;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const network = params.get("network") ?? "mainnet";
  const code = params.get("code") ?? "";
  const issuer = params.get("issuer") ?? "";

  if (network !== "mainnet") {
    return NextResponse.json({ error: "Network must be testnet or mainnet." }, { status: 400 });
  }
  if (!/^[A-Za-z0-9]{1,12}$/.test(code) || !/^G[A-Z2-7]{55}$/.test(issuer)) {
    return NextResponse.json({ error: "Provide a valid Stellar classic asset code and issuer account." }, { status: 400 });
  }

  const asset = code + "-" + issuer + (code.length <= 4 ? "-1" : "-2");
  const endpoint = "https://api.stellar.expert/explorer/" +
    (network === "mainnet" ? "public" : "testnet") +
    "/asset/" + encodeURIComponent(asset) + "/supply";
  const headers = new Headers({ Accept: "application/json" });
  const apiKey = process.env.STELLAR_EXPERT_API_KEY;
  if (apiKey) headers.set("Authorization", "Bearer " + apiKey);

  try {
    const response = await fetch(endpoint, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      return NextResponse.json({
        error: response.status === 404
          ? "StellarExpert has no indexed supply record for this asset."
          : response.status === 402
            ? "This StellarExpert endpoint requires an active API subscription."
            : response.status === 429
              ? "StellarExpert rate limit reached. Retry later."
              : "StellarExpert could not retrieve this asset's supply.",
        provider: "StellarExpert",
        network,
        asset
      }, { status: response.status === 404 ? 404 : 502 });
    }

    const body = (await response.text()).trim();
    let rawSupply = body;
    try {
      const parsed: unknown = JSON.parse(body);
      if (typeof parsed === "string" || typeof parsed === "number") rawSupply = String(parsed);
      else if (parsed && typeof parsed === "object" && "supply" in parsed) rawSupply = String((parsed as { supply: unknown }).supply);
    } catch {
      // The API documents supply as a scalar response; preserve its raw text for validation below.
    }
    if (!/^\d+$/.test(rawSupply)) {
      return NextResponse.json({
        error: "Temporarily unavailable.",
        provider: "StellarExpert",
        network,
        asset
      }, { status: 502 });
    }

    return NextResponse.json({
      network,
      provider: "StellarExpert",
      source: endpoint,
      asset,
      rawSupplyStroops: rawSupply,
      supply: formatStroops(rawSupply),
      decimals: 7,
      retrievedAt: new Date().toISOString()
    }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
  } catch (error) {
    return NextResponse.json({
      error: safeError(error, "stellar/intelligence/supply"),
      provider: "StellarExpert",
      network,
      asset
    }, { status: 502 });
  }
}
