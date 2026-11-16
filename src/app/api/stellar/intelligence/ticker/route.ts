import { safeError } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const network = params.get("network") ?? "mainnet";
  const symbol = (params.get("symbol") ?? "").trim();

  if (network !== "mainnet") {
    return NextResponse.json({ error: "Network must be testnet or mainnet." }, { status: 400 });
  }
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(symbol)) {
    return NextResponse.json({ error: "Enter a valid asset symbol." }, { status: 400 });
  }

  const endpoint = "https://api.stellar.expert/explorer/" +
    (network === "mainnet" ? "public" : "testnet") +
    "/ticker/" + encodeURIComponent(symbol);
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
          ? "No StellarExpert ticker record exists for this symbol."
          : response.status === 402
            ? "This StellarExpert ticker endpoint requires an active API subscription."
            : response.status === 429
              ? "StellarExpert rate limit reached. Retry later."
              : "StellarExpert ticker request failed.",
        provider: "StellarExpert",
        network,
        symbol
      }, { status: response.status === 404 ? 404 : 502 });
    }
    const payload: unknown = await response.json();
    return NextResponse.json({
      network,
      provider: "StellarExpert",
      source: endpoint,
      symbol,
      ticker: payload,
      retrievedAt: new Date().toISOString()
    }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
  } catch (error) {
    return NextResponse.json({
      error: safeError(error, "stellar/intelligence/ticker"),
      provider: "StellarExpert",
      network,
      symbol
    }, { status: 502 });
  }
}
