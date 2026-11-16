import { NextRequest, NextResponse } from "next/server";
import { Contract, Networks, rpc, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import { logServerError, UNAVAILABLE } from "@/lib/server/errors";
import { rateLimited } from "@/lib/server/rate-limit";
import { ensureVerifiedMainnetRpc, verifiedMainnetRpcUrl } from "@/lib/server/soroban";
import { assertListedVault, DefindexError, readVaultState } from "@/lib/server/defindex";
import { defindexDepositArgs, defindexWithdrawArgs, DEFINDEX_MAX_FEE_STROOPS, DEFINDEX_VALIDITY_SECONDS, scValsFromBase64 } from "@/lib/stellar/defindex-requests";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Soroban reads + simulation can exceed short serverless defaults; hosts that honour this get 30 s.
export const maxDuration = 30;
const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
const big = (v: unknown) => typeof v === "string" && /^\d{1,30}$/.test(v) ? BigInt(v) : null;

/**
 * Builds and simulates an unsigned DeFindex vault deposit or withdraw for the wallet.
 * Arguments are exactly those supplied (and independently re-encoded) by the client;
 * the guard refuses to sign if the built call differs.
 */
export async function POST(request: NextRequest) {
  if (rateLimited(request, "defindex-build", 20)) return json({ error: "Too many requests." }, 429);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const action = body.action, vault = String(body.vault ?? ""), wallet = String(body.wallet ?? "");
  if ((action !== "deposit" && action !== "withdraw") || !StrKey.isValidContract(vault) || !StrKey.isValidEd25519PublicKey(wallet)) return json({ error: "Invalid request." }, 400);

  let args: string[];
  try {
    if (action === "deposit") {
      const desired = Array.isArray(body.amounts) ? body.amounts.map(big) : [];
      const mins = Array.isArray(body.amountsMin) ? body.amountsMin.map(big) : [];
      if (desired.some(x => x === null) || mins.some(x => x === null)) throw new Error("invalid");
      args = defindexDepositArgs(wallet, desired as bigint[], mins as bigint[], true);
    } else {
      const shares = big(body.shares);
      const mins = Array.isArray(body.minAmountsOut) ? body.minAmountsOut.map(big) : [];
      if (shares === null || mins.some(x => x === null)) throw new Error("invalid");
      args = defindexWithdrawArgs(wallet, shares, mins as bigint[]);
    }
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  if (!(await ensureVerifiedMainnetRpc())) return json({ error: UNAVAILABLE, status: "soroban_unavailable" }, 503);

  try {
    await assertListedVault(vault);
    const state = await readVaultState(vault, null, null);
    const expectedLen = state.assets.length;
    const vecLen = action === "deposit" ? (body.amounts as unknown[]).length : (body.minAmountsOut as unknown[]).length;
    if (vecLen !== expectedLen) return json({ error: "Invalid request." }, 400);

    const server = new rpc.Server(verifiedMainnetRpcUrl());
    const account = await server.getAccount(wallet);
    const tx = new TransactionBuilder(account, { fee: "1000", networkPassphrase: Networks.PUBLIC })
      .addOperation(new Contract(vault).call(action, ...scValsFromBase64(args)))
      .setTimeout(DEFINDEX_VALIDITY_SECONDS)
      .build();
    const simulation = await server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(simulation)) {
      logServerError("stellar/defindex/build:simulation", new Error(JSON.stringify((simulation as { error?: unknown }).error ?? "simulation failed").slice(0, 800)));
      return json({ error: "This action would fail. Check the amount and your balance.", status: "simulation_failed" }, 422);
    }
    const prepared = rpc.assembleTransaction(tx, simulation).build();
    if (Number(prepared.fee) > DEFINDEX_MAX_FEE_STROOPS) return json({ error: "The network fee for this action is unusually high. Try again later." }, 409);
    return json({ xdr: prepared.toEnvelope().toXDR("base64"), fee: prepared.fee });
  } catch (error) {
    if (error instanceof DefindexError && (error.code === "not_listed" || error.code === "not_a_vault")) return json({ error: "This vault isn't available." }, 404);
    const requestId = logServerError("stellar/defindex/build", error);
    return json({ error: UNAVAILABLE, requestId }, 502);
  }
}
