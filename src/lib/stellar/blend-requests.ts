import { PoolContractV2, RequestType } from "@blend-capital/blend-sdk";
import { scValToNative, StrKey, xdr } from "@stellar/stellar-sdk";
import { NEXORA_NETWORK_PASSPHRASE, type SignIntent } from "./tx-guard";

/** Blend pool actions NEXORA supports. Supply/withdraw use collateral positions. */
export const BLEND_ACTIONS = {
  supply: RequestType.SupplyCollateral,
  withdraw: RequestType.WithdrawCollateral,
  borrow: RequestType.Borrow,
  repay: RequestType.Repay
} as const;
export type BlendAction = keyof typeof BLEND_ACTIONS;

export const BLEND_REQUEST_NAMES: Record<number, string> = {
  0: "Supply", 1: "Withdraw", 2: "Supply as collateral", 3: "Withdraw collateral", 4: "Borrow", 5: "Repay",
  6: "Fill liquidation", 7: "Fill bad debt", 8: "Fill interest auction", 9: "Delete auction"
};

/** Upper bound for a Soroban transaction fee (inclusion + resources) the user can approve. */
export const MAX_SOROBAN_FEE_STROOPS = 20_000_000; // 2 XLM
export const SOROBAN_VALIDITY_SECONDS = 180;

export function toUnits(amount: string, decimals: number): bigint | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!m || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) return null;
  const frac = m[2] ?? "";
  if (frac.length > decimals) return null;
  return BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
}

/**
 * The exact `submit` arguments for a single-request Blend action where the wallet is
 * from, spender and recipient. Computed independently on the client and compared
 * byte-for-byte with the server-built transaction by the guard.
 */
export function blendSubmitArgs(poolId: string, wallet: string, action: BlendAction, assetContract: string, units: bigint): string[] {
  if (!StrKey.isValidContract(poolId) || !StrKey.isValidContract(assetContract) || !StrKey.isValidEd25519PublicKey(wallet) || units <= 0n) {
    throw new Error("invalid_blend_request");
  }
  const opXdr = new PoolContractV2(poolId).submit({
    from: wallet, spender: wallet, to: wallet,
    requests: [{ request_type: BLEND_ACTIONS[action], address: assetContract, amount: units }]
  });
  const op = xdr.Operation.fromXDR(String(opXdr), "base64") as unknown as { body: () => { invokeHostFunctionOp: () => { hostFunction: () => { invokeContract: () => { args: () => { toXDR: (f: "base64") => string }[] } } } } };
  try {
    return op.body().invokeHostFunctionOp().hostFunction().invokeContract().args().map(a => a.toXDR("base64"));
  } catch {
    // SDK 17 plain-object XDR
    const plain = op as unknown as { body: { invokeHostFunctionOp: { hostFunction: { invokeContract: { args: { toXDR: (f: "base64") => string }[] } } } } };
    return plain.body.invokeHostFunctionOp.hostFunction.invokeContract.args.map(a => a.toXDR("base64"));
  }
}

export function blendIntent(poolId: string, args: string[]): Omit<SignIntent, "source"> {
  return {
    networkPassphrase: NEXORA_NETWORK_PASSPHRASE,
    operations: [{ type: "invokeContract", contractId: poolId, functionName: "submit", args }],
    maxFeeStroops: MAX_SOROBAN_FEE_STROOPS,
    maxValiditySeconds: SOROBAN_VALIDITY_SECONDS + 15
  };
}

/** Decodes Blend `submit` requests for the approval sheet (raw units; decimals applied when known). */
export function describeBlendRequests(args: unknown[], decimalsFor: (contract: string) => number | null): [string, string][] {
  try {
    const requests = scValToNative(args[3] as never) as { address: string; amount: bigint; request_type: number }[];
    return requests.flatMap(r => {
      const d = decimalsFor(r.address);
      const amount = d === null ? `${r.amount} units` : formatUnits(BigInt(r.amount), d);
      return [[BLEND_REQUEST_NAMES[Number(r.request_type)] ?? "Request", `${amount} · ${r.address.slice(0, 6)}…${r.address.slice(-6)}`] as [string, string]];
    });
  } catch {
    return [];
  }
}

export function formatUnits(units: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = units / base;
  const frac = (units % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}
