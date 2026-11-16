import { safeError } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const network = request.nextUrl.searchParams.get("network") ?? "mainnet";
  const address = request.nextUrl.searchParams.get("address") ?? "";
  if (network !== "mainnet") {
    return NextResponse.json({ error: "Unsupported Stellar network." }, { status: 400 });
  }
  if (!/^C[A-Z2-7]{55}$/.test(address)) {
    return NextResponse.json({ error: "Enter a valid contract address." }, { status: 400 });
  }

  const apiKey = process.env.DEFINDEX_API_KEY;
  const headers: HeadersInit = { Accept: "application/json" };
  if (apiKey) headers.Authorization = "Bearer " + apiKey;

  try {
    const response = await fetch("https://api.defindex.io/vault/" + encodeURIComponent(address) + "?network=" + network, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      headers
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = safeError(new Error("DeFindex vault HTTP " + response.status + ": " + JSON.stringify(data).slice(0, 300)), "stellar/defindex/vault");
      return NextResponse.json({
        network,
        address,
        addressFormatValid: true,
        metadata: null,
        error: message,
        authRequired: response.status === 401 || response.status === 403 || !apiKey
      }, { status: response.status === 401 || response.status === 403 ? 200 : response.status, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({
      network,
      address,
      addressFormatValid: true,
      source: "DeFindex vault metadata API",
      retrievedAt: new Date().toISOString(),
      metadata: data,
      error: null,
      authRequired: false
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      network,
      address,
      addressFormatValid: true,
      metadata: null,
      error: safeError(error, "stellar/defindex/vault"),
      authRequired: !apiKey
    }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
