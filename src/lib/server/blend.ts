import "server-only";
import { Networks } from "@stellar/stellar-sdk";
import { PoolMetadata, PoolV2 } from "@blend-capital/blend-sdk";
import { verifiedMainnetRpcUrl } from "./soroban";

/** Official Blend V2 Mainnet deployments NEXORA will interact with. */
export const BLEND_MAINNET = {
  backstops: ["CAQQR5SWBXKIGZKPBZDH3KM5GQ5GUTPKB7JAFCINLZBC5WXPJKRG3IM7", "CCS4AZ5ORM6VLLPJTJUFRNXWBMHOO3L5WHHRPL2ZMILE35ZDMQFHOQMJ"],
  pools: ["CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD", "CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS", "CBAKAZUEJBAFA2DCGBRS2WKJT3FNIMJBHTFL76AY7XMAVEINQNNIQWAO"],
  wasmHashes: ["a41fc53d6753b6c04eb15b021c55052366a4c8e0e21bc72700f461264ec1350e", "6a7c67449f6bad0d5f641cfbdf03f430ec718faa85107ecb0b97df93410d1c43"]
};

export class BlendPoolError extends Error {
  constructor(public readonly code: "not_allowlisted" | "unverified" | "no_reserve") { super(code); }
}

/** Loads a pool only if it is allow-listed AND its on-chain wasm hash and backstop match the official deployment. */
export async function loadVerifiedPool(poolId: string) {
  if (!BLEND_MAINNET.pools.includes(poolId)) throw new BlendPoolError("not_allowlisted");
  const network = { rpc: verifiedMainnetRpcUrl(), passphrase: Networks.PUBLIC };
  const metadata = await PoolMetadata.load(network, poolId);
  if (!BLEND_MAINNET.wasmHashes.includes(metadata.wasmHash) || !BLEND_MAINNET.backstops.includes(metadata.backstop)) throw new BlendPoolError("unverified");
  const pool = await PoolV2.loadWithMetadata(network, poolId, metadata);
  return { pool, metadata, network };
}
