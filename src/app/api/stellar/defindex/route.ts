import { safeError } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type JsonRecord = Record<string, unknown>;

async function readPublicEndpoint(url: string): Promise<{ data: unknown | null; error: string | null }> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      headers: { Accept: "application/json" }
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = safeError(new Error("DeFindex HTTP " + response.status + ": " + JSON.stringify(payload).slice(0, 300)), "stellar/defindex");
      return { data: null, error: message };
    }
    return { data: payload, error: null };
  } catch (error) {
    return {
      data: null,
      error: safeError(error, "stellar/defindex")
    };
  }
}

function records(payload: unknown, key: string): JsonRecord[] {
  if (Array.isArray(payload)) return payload.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object");
  if (!payload || typeof payload !== "object") return [];
  const value = (payload as JsonRecord)[key];
  return Array.isArray(value) ? value.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object") : [];
}

export async function GET(request: NextRequest) {
  const network = request.nextUrl.searchParams.get("network") ?? "mainnet";
  if (network !== "mainnet") {
    return NextResponse.json({ error: "Unsupported Stellar network." }, { status: 400 });
  }

  const base = "https://api.defindex.io";
  const [vaultResult, strategyResult, healthResult, factoryResult] = await Promise.all([
    readPublicEndpoint(base + "/vault/discover?network=" + network),
    readPublicEndpoint(base + "/strategies?network=" + network),
    readPublicEndpoint(base + "/health"),
    readPublicEndpoint(base + "/factory/address?network=" + network)
  ]);
  const vaults = records(vaultResult.data, "vaults");
  const strategies = records(strategyResult.data, "strategies");
  const healthData = healthResult.data && typeof healthResult.data === "object" ? healthResult.data as JsonRecord : null;
  const healthStatus = healthData?.status && typeof healthData.status === "object" ? healthData.status as JsonRecord : null;
  const factoryData = factoryResult.data && typeof factoryResult.data === "object" ? factoryResult.data as JsonRecord : null;

  return NextResponse.json({
    network,
    source: "DeFindex public REST discovery endpoints",
    retrievedAt: new Date().toISOString(),
    totalVaults: vaultResult.data && typeof vaultResult.data === "object" && "totalVaults" in vaultResult.data
      ? (vaultResult.data as JsonRecord).totalVaults
      : vaults.length,
    vaults,
    strategies,
    health: { reachable: typeof healthStatus?.reachable === "boolean" ? healthStatus.reachable : null },
    factory: { address: typeof factoryData?.address === "string" ? factoryData.address : null },
    errors: {
      vaults: vaultResult.error,
      strategies: strategyResult.error,
      health: healthResult.error,
      factory: factoryResult.error
    }
  }, { headers: { "Cache-Control": "no-store" } });
}
