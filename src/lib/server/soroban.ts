import "server-only";
import { Networks, rpc } from "@stellar/stellar-sdk";
import { logServerError } from "./errors";

/**
 * Mainnet Soroban RPC — explicitly configured and verified, never assumed.
 *
 * STELLAR_MAINNET_SOROBAN_RPC_URL must point to the operator's chosen provider.
 * Before any Soroban feature uses it, the endpoint must (a) be HTTPS, (b) report
 * the Stellar Mainnet network passphrase via getNetwork, and (c) report
 * "healthy" via getHealth. There is no fallback endpoint: if any check fails,
 * Soroban features are reported as unavailable.
 */

const VERIFIED_TTL_MS = 5 * 60_000;
const FAILED_RETRY_MS = 30_000;

type State = { url: string; ok: boolean; checkedAt: number; latestLedger?: number };
let state: State | null = null;
let inflight: Promise<boolean> | null = null;

export type SorobanStatus = { configured: boolean; verified: boolean; checkedAt: string | null };

function configuredUrl(): string | null {
  const raw = process.env.STELLAR_MAINNET_SOROBAN_RPC_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

async function verify(url: string): Promise<boolean> {
  const server = new rpc.Server(url);
  try {
    const [network, health] = await Promise.all([server.getNetwork(), server.getHealth()]);
    if (network.passphrase !== Networks.PUBLIC) throw new Error("Soroban RPC reports a non-Mainnet passphrase");
    if (health.status !== "healthy") throw new Error("Soroban RPC health status: " + health.status);
    state = { url, ok: true, checkedAt: Date.now(), latestLedger: health.latestLedger };
    return true;
  } catch (error) {
    logServerError("soroban-rpc:verify", error);
    state = { url, ok: false, checkedAt: Date.now() };
    return false;
  }
}

/** Resolves true only if the configured Mainnet RPC is verified (cached). */
export async function ensureVerifiedMainnetRpc(): Promise<boolean> {
  const url = configuredUrl();
  if (!url) return false;
  const now = Date.now();
  if (state && state.url === url) {
    if (state.ok && now - state.checkedAt < VERIFIED_TTL_MS) return true;
    if (!state.ok && now - state.checkedAt < FAILED_RETRY_MS) return false;
  }
  inflight ??= verify(url).finally(() => { inflight = null; });
  return inflight;
}

/** Synchronous accessor for code paths that already awaited ensureVerifiedMainnetRpc(). */
export function verifiedMainnetRpcUrl(): string {
  const url = configuredUrl();
  if (!url || !state || state.url !== url || !state.ok) throw new Error("Soroban RPC not verified");
  return url;
}

export function sorobanStatus(): SorobanStatus {
  const url = configuredUrl();
  return {
    configured: Boolean(url),
    verified: Boolean(url && state?.url === url && state.ok),
    checkedAt: state && state.url === url ? new Date(state.checkedAt).toISOString() : null
  };
}

/** Test hook. */
export function __resetSorobanStateForTests() {
  state = null;
  inflight = null;
}
