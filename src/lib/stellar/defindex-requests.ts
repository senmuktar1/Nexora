import { Address, nativeToScVal, StrKey, xdr } from "@stellar/stellar-sdk";
import { NEXORA_NETWORK_PASSPHRASE, type SignIntent } from "./tx-guard";

/**
 * DeFindex vault calls (vault contract interface):
 *   deposit(amounts_desired: Vec<i128>, amounts_min: Vec<i128>, from: Address, invest: bool)
 *   withdraw(withdraw_shares: i128, min_amounts_out: Vec<i128>, from: Address)
 * Vector order follows the vault's get_assets() order.
 *
 * The client encodes these arguments itself; the guard requires the server-built,
 * simulated transaction to carry exactly the same bytes.
 */

export const DEFINDEX_MAX_FEE_STROOPS = 20_000_000; // 2 XLM
export const DEFINDEX_VALIDITY_SECONDS = 180;
export const MAX_SLIPPAGE_BPS = 500;

const i128 = (v: bigint) => nativeToScVal(v, { type: "i128" });
const vecI128 = (vs: bigint[]) => xdr.ScVal.scvVec(vs.map(i128));
const b64 = (v: xdr.ScVal) => (v as unknown as { toXDR: (f: "base64") => string }).toXDR("base64");

function assertWallet(wallet: string) {
  if (!StrKey.isValidEd25519PublicKey(wallet)) throw new Error("invalid_wallet");
}

/** Applies slippage (basis points) to each expected amount, rounding down. */
export function withSlippage(amounts: bigint[], bps: number): bigint[] {
  if (!Number.isInteger(bps) || bps < 1 || bps > MAX_SLIPPAGE_BPS) throw new Error("invalid_slippage");
  return amounts.map(a => (a * BigInt(10_000 - bps)) / 10_000n);
}

export function defindexDepositArgs(wallet: string, amountsDesired: bigint[], amountsMin: bigint[], invest = true): string[] {
  assertWallet(wallet);
  if (amountsDesired.length === 0 || amountsDesired.length !== amountsMin.length) throw new Error("invalid_amounts");
  if (amountsDesired.some(a => a < 0n) || amountsDesired.every(a => a === 0n)) throw new Error("invalid_amounts");
  if (amountsMin.some((m, i) => m < 0n || m > amountsDesired[i])) throw new Error("invalid_amounts");
  return [b64(vecI128(amountsDesired)), b64(vecI128(amountsMin)), b64(new Address(wallet).toScVal()), b64(nativeToScVal(invest))];
}

export function defindexWithdrawArgs(wallet: string, shares: bigint, minAmountsOut: bigint[]): string[] {
  assertWallet(wallet);
  if (shares <= 0n || minAmountsOut.length === 0 || minAmountsOut.some(m => m < 0n)) throw new Error("invalid_amounts");
  return [b64(i128(shares)), b64(vecI128(minAmountsOut)), b64(new Address(wallet).toScVal())];
}

export function defindexIntent(vault: string, functionName: "deposit" | "withdraw", args: string[]): Omit<SignIntent, "source"> {
  if (!StrKey.isValidContract(vault)) throw new Error("invalid_vault");
  return {
    networkPassphrase: NEXORA_NETWORK_PASSPHRASE,
    operations: [{ type: "invokeContract", contractId: vault, functionName, args }],
    maxFeeStroops: DEFINDEX_MAX_FEE_STROOPS,
    maxValiditySeconds: DEFINDEX_VALIDITY_SECONDS + 15
  };
}

/** Decodes base64 ScVal args back to native values (used by the server to rebuild the call). */
export function scValsFromBase64(args: string[]): xdr.ScVal[] {
  return args.map(a => xdr.ScVal.fromXDR(a, "base64"));
}
