import "server-only";
import { normalisePredicate, type ClaimableBalance } from "@/lib/stellar/voucher";

/** Default: the Stellar Development Foundation's public Mainnet Horizon. */
export const DEFAULT_HORIZON_URL = "https://horizon.stellar.org";

/** Server-only Horizon base URL (STELLAR_HORIZON_URL), HTTPS required, no trailing slash. */
export function resolveHorizonUrl(raw = process.env.STELLAR_HORIZON_URL): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_HORIZON_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("not https");
    return url.toString().replace(/\/$/, "");
  } catch {
    console.error(JSON.stringify({ level: "error", scope: "config", message: "STELLAR_HORIZON_URL is invalid; using default" }));
    return DEFAULT_HORIZON_URL;
  }
}

export const HORIZON = resolveHorizonUrl();

export function assetIdFromHorizon(asset: unknown): string | null {
  if (asset === "native") return "native";
  if (typeof asset !== "string") return null;
  const [code, issuer] = asset.split(":");
  return code && issuer && /^G[A-Z2-7]{55}$/.test(issuer) && /^[A-Za-z0-9]{1,12}$/.test(code) ? `${code}:${issuer}` : null;
}

export function normaliseClaimableBalance(record: Record<string, unknown>): ClaimableBalance | null {
  const asset = assetIdFromHorizon(record.asset);
  if (typeof record.id !== "string" || !asset || typeof record.amount !== "string") return null;
  const claimants = Array.isArray(record.claimants) ? record.claimants as { destination?: unknown; predicate?: unknown }[] : [];
  return {
    id: record.id.toLowerCase(),
    asset,
    amount: record.amount,
    sponsor: typeof record.sponsor === "string" ? record.sponsor : null,
    createdAt: typeof record.last_modified_time === "string" ? record.last_modified_time : null,
    claimants: claimants
      .filter(c => typeof c.destination === "string")
      .map(c => ({ destination: c.destination as string, predicate: normalisePredicate(c.predicate) }))
  };
}
