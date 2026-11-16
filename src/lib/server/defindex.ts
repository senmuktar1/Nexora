import "server-only";
import { Account, Address, Contract, Keypair, nativeToScVal, Networks, rpc, scValToNative, StrKey, TransactionBuilder, type xdr } from "@stellar/stellar-sdk";
import { verifiedMainnetRpcUrl } from "./soroban";

/**
 * DeFindex vault access. A vault is usable only if it is listed by DeFindex's
 * public discovery API AND its on-chain interface responds as a vault. Reads
 * are Soroban simulations (no signing, no fees).
 */

const DISCOVERY_URL = "https://api.defindex.io/vault/discover?network=mainnet";
const LIST_TTL_MS = 10 * 60_000;
let listed: { at: number; vaults: Set<string> } | null = null;

export class DefindexError extends Error {
  constructor(public readonly code: "not_listed" | "discovery_unavailable" | "not_a_vault" | "read_failed") { super(code); }
}

export async function listedVaults(): Promise<Set<string>> {
  if (listed && Date.now() - listed.at < LIST_TTL_MS) return listed.vaults;
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = process.env.DEFINDEX_API_KEY?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  const response = await fetch(DISCOVERY_URL, { cache: "no-store", signal: AbortSignal.timeout(8000), headers }).catch(() => null);
  if (!response?.ok) throw new DefindexError("discovery_unavailable");
  const data = await response.json().catch(() => null) as { vaults?: { address?: unknown }[] } | null;
  const vaults = new Set((data?.vaults ?? []).map(v => v.address).filter((a): a is string => typeof a === "string" && StrKey.isValidContract(a)));
  listed = { at: Date.now(), vaults };
  return vaults;
}

export async function assertListedVault(vault: string) {
  if (!(await listedVaults()).has(vault)) throw new DefindexError("not_listed");
}

async function simulateRead(server: rpc.Server, contractId: string, fn: string, args: xdr.ScVal[] = []): Promise<unknown> {
  const source = new Account(Keypair.random().publicKey(), "0");
  const tx = new TransactionBuilder(source, { fee: "100", networkPassphrase: Networks.PUBLIC })
    .addOperation(new Contract(contractId).call(fn, ...args)).setTimeout(30).build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new DefindexError("read_failed");
  return scValToNative(sim.result.retval);
}

export type VaultAsset = { address: string; symbol: string | null; decimals: number | null };
export type VaultState = { vault: string; name: string | null; symbol: string | null; assets: VaultAsset[]; totalShares: string; userShares: string | null; userAmounts: string[] | null; amountsForShares: string[] | null };

export async function readVaultState(vault: string, wallet: string | null, sharesQuery: bigint | null): Promise<VaultState> {
  const server = new rpc.Server(verifiedMainnetRpcUrl());
  let rawAssets: unknown;
  try { rawAssets = await simulateRead(server, vault, "get_assets"); } catch { throw new DefindexError("not_a_vault"); }
  if (!Array.isArray(rawAssets) || rawAssets.length === 0) throw new DefindexError("not_a_vault");
  const assets: VaultAsset[] = await Promise.all(rawAssets.map(async (a: { address?: unknown }) => {
    const address = String(a?.address ?? "");
    if (!StrKey.isValidContract(address)) throw new DefindexError("not_a_vault");
    const [symbol, decimals] = await Promise.all([
      simulateRead(server, address, "symbol").then(v => typeof v === "string" ? v : null).catch(() => null),
      simulateRead(server, address, "decimals").then(v => typeof v === "number" ? v : Number(v)).catch(() => null)
    ]);
    return { address, symbol, decimals: Number.isInteger(decimals) ? decimals as number : null };
  }));
  const [name, symbol, totalShares] = await Promise.all([
    simulateRead(server, vault, "name").then(v => typeof v === "string" ? v : null).catch(() => null),
    simulateRead(server, vault, "symbol").then(v => typeof v === "string" ? v : null).catch(() => null),
    simulateRead(server, vault, "total_supply").then(v => String(v)).catch(() => "0")
  ]);
  let userShares: string | null = null, userAmounts: string[] | null = null, amountsForShares: string[] | null = null;
  const perShares = async (shares: bigint) => {
    const out = await simulateRead(server, vault, "get_asset_amounts_per_shares", [nativeToScVal(shares, { type: "i128" })]);
    return Array.isArray(out) ? out.map(x => String(x)) : null;
  };
  if (wallet) {
    const bal = await simulateRead(server, vault, "balance", [new Address(wallet).toScVal()]).catch(() => 0n);
    userShares = String(bal);
    userAmounts = BigInt(userShares) > 0n ? await perShares(BigInt(userShares)).catch(() => null) : assets.map(() => "0");
  }
  if (sharesQuery !== null && sharesQuery > 0n) amountsForShares = await perShares(sharesQuery).catch(() => null);
  return { vault, name, symbol, assets, totalShares, userShares, userAmounts, amountsForShares };
}
