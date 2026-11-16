import { ensureVerifiedMainnetRpc, verifiedMainnetRpcUrl } from "@/lib/server/soroban";
import { UNAVAILABLE } from "@/lib/server/errors";
import { safeError } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";
import { Networks, rpc } from "@stellar/stellar-sdk";
import { PoolMetadata, PoolOracle, PoolV2, TokenMetadata } from "@blend-capital/blend-sdk";

export const dynamic = "force-dynamic";
// Soroban reads + simulation can exceed short serverless defaults; hosts that honour this get 30 s.
export const maxDuration = 30;
export const revalidate = 0;

const CONFIG = {
  testnet: {
    rpc: "https://soroban-testnet.stellar.org",
    passphrase: Networks.TESTNET,
    backstops: ["CBDVWXT433PRVTUNM56C3JREF3HIZHRBA64NB2C3B2UNCKIS65ZYCLZA", "CBGSFY6NR5TSCQJH5EGVMCFTHLZBCAO7YPIW426WSD46V3TESPA3U6DI"],
    pools: [{ id: "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF", label: "Blend Testnet V2" }]
  },
  mainnet: {
    get rpc() { return verifiedMainnetRpcUrl(); },
    passphrase: Networks.PUBLIC,
    backstops: ["CAQQR5SWBXKIGZKPBZDH3KM5GQ5GUTPKB7JAFCINLZBC5WXPJKRG3IM7", "CCS4AZ5ORM6VLLPJTJUFRNXWBMHOO3L5WHHRPL2ZMILE35ZDMQFHOQMJ"],
    pools: [
      { id: "CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD", label: "Fixed V2" },
      { id: "CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS", label: "YieldBlox V2" },
      { id: "CBAKAZUEJBAFA2DCGBRS2WKJT3FNIMJBHTFL76AY7XMAVEINQNNIQWAO", label: "Fixed V2.1" }
    ]
  }
} as const;

const ALLOWED_POOL_HASHES = new Set([
  "a41fc53d6753b6c04eb15b021c55052366a4c8e0e21bc72700f461264ec1350e",
  "6a7c67449f6bad0d5f641cfbdf03f430ec718faa85107ecb0b97df93410d1c43"
]);

function finite(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

async function loadPool(network: "testnet" | "mainnet", candidate: {id:string;label:string}) {
  const config = CONFIG[network];
  const sdkNetwork = { rpc: config.rpc, passphrase: config.passphrase };
  const metadata = await PoolMetadata.load(sdkNetwork, candidate.id);
  if (!ALLOWED_POOL_HASHES.has(metadata.wasmHash) || !config.backstops.includes(metadata.backstop as never)) {
    throw new Error("Pool contract identity did not match the official Blend V2 deployment manifest.");
  }
  const pool = await PoolV2.loadWithMetadata(sdkNetwork, candidate.id, metadata);
  // Load oracle prices independently per reserve. Pool.loadOracle() rejects the entire
  // batch when even one asset has no SEP-40 price, hiding otherwise valid reserve prices.
  const reserves = await Promise.all(Array.from(pool.reserves.values()).map(async reserve => {
    let oraclePrice: number | null = null;
    let oracleLedger: number | null = null;
    let oracleReadError: string | null = null;
    try {
      const assetOracle = await PoolOracle.load(sdkNetwork, metadata.oracle, [reserve.assetId]);
      const price = assetOracle.getPriceFloat(reserve.assetId);
      oraclePrice = price === undefined ? null : finite(price);
      oracleLedger = assetOracle.latestLedger;
      if (price === undefined) oracleReadError = "Oracle returned no price for this reserve.";
    } catch (error) {
      oracleReadError = safeError(error, "stellar/blend");
    }
    let token: {symbol:string;name:string;decimals:number} | null = null;
    try {
      const data = await TokenMetadata.load(sdkNetwork, reserve.assetId);
      token = { symbol: data.symbol, name: data.name, decimals: data.decimals };
    } catch {
      // Keep the on-chain asset contract address visible when optional token metadata is unavailable.
    }
    const enabled = "enabled" in reserve.config ? Boolean(reserve.config.enabled) : true;
    return {
      assetContract: reserve.assetId,
      symbol: token?.symbol ?? null,
      name: token?.name ?? null,
      decimals: reserve.config.decimals,
      tokenDecimals: token?.decimals ?? null,
      decimalsMatch: token ? token.decimals === reserve.config.decimals : null,
      oraclePrice,
      oracleValueSupplied: oraclePrice === null ? null : finite(reserve.totalSupplyFloat() * oraclePrice),
      oracleValueBorrowed: oraclePrice === null ? null : finite(reserve.totalLiabilitiesFloat() * oraclePrice),
      oracleLedger,
      oracleReadError,
      enabled,
      supplyApr: finite(reserve.supplyApr),
      borrowApr: finite(reserve.borrowApr),
      estimatedSupplyApy: finite(reserve.estSupplyApy),
      estimatedBorrowApy: finite(reserve.estBorrowApy),
      utilization: finite(reserve.getUtilizationFloat()),
      supplied: finite(reserve.totalSupplyFloat()),
      borrowed: finite(reserve.totalLiabilitiesFloat()),
      collateralFactor: finite(reserve.getCollateralFactor()),
      liabilityFactor: finite(reserve.getLiabilityFactor()),
      latestLedger: reserve.latestLedger
    };
  }));
  return {
    id: candidate.id,
    label: candidate.label,
    name: metadata.name,
    version: metadata.backstop === config.backstops[1] ? "V2.1" : "V2",
    status: metadata.status,
    admin: metadata.admin,
    backstop: metadata.backstop,
    oracle: metadata.oracle,
    oracleLedger: reserves.reduce<number|null>((latest, reserve) => reserve.oracleLedger === null ? latest : latest === null ? reserve.oracleLedger : Math.max(latest,reserve.oracleLedger),null),
    oracleReadAvailable: reserves.some(reserve => reserve.oraclePrice !== null),
    oracleReadError: reserves.filter(reserve => reserve.oracleReadError).map(reserve => reserve.symbol + ": " + reserve.oracleReadError).join(" | ") || null,
    wasmHash: metadata.wasmHash,
    latestLedger: metadata.latestLedger,
    reserves
  };
}

export async function GET(request: NextRequest) {
  const network = request.nextUrl.searchParams.get("network") ?? "mainnet";
  if (network !== "mainnet") {
    return NextResponse.json({ error: "Unsupported Stellar network." }, { status: 400 });
  }
  if (network !== "mainnet" || !(await ensureVerifiedMainnetRpc())) {
    return NextResponse.json({ error: UNAVAILABLE, status: "soroban_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const config = CONFIG[network];
  try {
    const server = new rpc.Server(config.rpc);
    const ledger = await server.getLatestLedger();
    const settled = await Promise.allSettled(config.pools.map(candidate => loadPool(network, candidate)));
    const pools = settled.flatMap(result => result.status === "fulfilled"
      ? [result.value]
      : []);
    const unavailable = settled.flatMap((result, index) => result.status === "rejected"
      ? [{ id: config.pools[index].id, label: config.pools[index].label, reason: safeError(result.reason, "stellar/blend:pool") }]
      : []);
    return NextResponse.json({
      network,
      source: "Blend Soroban contracts via official Blend SDK",
      ledger: ledger.sequence,
      retrievedAt: new Date().toISOString(),
      pools,
      unavailable
    }, { headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=40" } });
  } catch (error) {
    return NextResponse.json({ error: safeError(error, "stellar/blend") }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
