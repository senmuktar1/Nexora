import { NextRequest, NextResponse } from "next/server";
import { Networks, rpc, StrKey, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { PoolContractV2 } from "@blend-capital/blend-sdk";
import { logServerError, UNAVAILABLE } from "@/lib/server/errors";
import { rateLimited } from "@/lib/server/rate-limit";
import { ensureVerifiedMainnetRpc, verifiedMainnetRpcUrl } from "@/lib/server/soroban";
import { BlendPoolError, loadVerifiedPool } from "@/lib/server/blend";
import { BLEND_ACTIONS, MAX_SOROBAN_FEE_STROOPS, SOROBAN_VALIDITY_SECONDS, type BlendAction } from "@/lib/stellar/blend-requests";

export const dynamic = "force-dynamic";
// Soroban reads + simulation can exceed short serverless defaults; hosts that honour this get 30 s.
export const maxDuration = 30;
const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

/**
 * Builds and simulates an unsigned Blend `submit` transaction for the wallet.
 * The client independently re-derives the exact call arguments and the guard
 * refuses to sign if anything differs, so this route cannot alter the request.
 */
export async function POST(request: NextRequest) {
  if (rateLimited(request, "blend-build", 20)) return json({ error: "Too many requests." }, 429);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const action = String(body.action ?? "") as BlendAction;
  const poolId = String(body.poolId ?? "");
  const asset = String(body.asset ?? "");
  const wallet = String(body.wallet ?? "");
  const units = /^\d{1,30}$/.test(String(body.units ?? "")) ? BigInt(String(body.units)) : 0n;
  if (!(action in BLEND_ACTIONS) || !StrKey.isValidContract(poolId) || !StrKey.isValidContract(asset) || !StrKey.isValidEd25519PublicKey(wallet) || units <= 0n) {
    return json({ error: "Invalid request." }, 400);
  }
  if (!(await ensureVerifiedMainnetRpc())) return json({ error: UNAVAILABLE, status: "soroban_unavailable" }, 503);

  try {
    const { pool } = await loadVerifiedPool(poolId);
    const reserve = Array.from(pool.reserves.values()).find(r => r.assetId === asset);
    if (!reserve) return json({ error: "This asset isn't available in this market." }, 404);
    if ("enabled" in reserve.config && !reserve.config.enabled && (action === "supply" || action === "borrow")) {
      return json({ error: "This market isn't accepting new positions." }, 409);
    }

    const server = new rpc.Server(verifiedMainnetRpcUrl());
    const account = await server.getAccount(wallet);
    const op = xdr.Operation.fromXDR(String(new PoolContractV2(poolId).submit({
      from: wallet, spender: wallet, to: wallet,
      requests: [{ request_type: BLEND_ACTIONS[action], address: asset, amount: units }]
    })), "base64");
    const tx = new TransactionBuilder(account, { fee: "1000", networkPassphrase: Networks.PUBLIC })
      .addOperation(op as never)
      .setTimeout(SOROBAN_VALIDITY_SECONDS)
      .build();
    const simulation = await server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(simulation)) {
      logServerError("stellar/blend/build:simulation", new Error(JSON.stringify((simulation as { error?: unknown }).error ?? "simulation failed").slice(0, 800)));
      return json({ error: "This action would fail with your current position. Check the amount.", status: "simulation_failed" }, 422);
    }
    const prepared = rpc.assembleTransaction(tx, simulation).build();
    if (Number(prepared.fee) > MAX_SOROBAN_FEE_STROOPS) return json({ error: "The network fee for this action is unusually high. Try again later." }, 409);
    return json({ xdr: prepared.toEnvelope().toXDR("base64"), fee: prepared.fee, latestLedger: simulation.latestLedger });
  } catch (error) {
    if (error instanceof BlendPoolError) return json({ error: "This market could not be verified." }, error.code === "not_allowlisted" ? 403 : 409);
    const requestId = logServerError("stellar/blend/build", error);
    return json({ error: UNAVAILABLE, requestId }, 502);
  }
}
