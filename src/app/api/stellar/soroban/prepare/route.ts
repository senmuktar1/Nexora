import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "buffer";
import { Address, FeeBumpTransaction, hash, Networks, rpc, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { logServerError, UNAVAILABLE } from "@/lib/server/errors";
import { rateLimited } from "@/lib/server/rate-limit";
import { ensureVerifiedMainnetRpc, verifiedMainnetRpcUrl } from "@/lib/server/soroban";
import { DEPLOY_MAX_FEE_STROOPS, NEXORA_TOKEN_WASM_HASH, UPLOAD_MAX_FEE_STROOPS } from "@/lib/stellar/soroban-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Soroban simulation can exceed short serverless defaults; hosts that honour this get 30 s.
export const maxDuration = 30;
const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
const hex = (v: unknown): string => v instanceof Uint8Array ? Buffer.from(v).toString("hex") : v && typeof v === "object" && "value" in v ? hex((v as { value: unknown }).value) : "";

type Kind = "upload" | "deploy";

/** Accepts only: upload of the pinned NEXORA token code, or deployment of it by the tx source. */
function classify(tx: Transaction): Kind | null {
  if (tx.operations.length !== 1 || tx.operations[0].type !== "invokeHostFunction") return null;
  const op = tx.operations[0] as unknown as { source?: string; func: { type: string; wasm?: Uint8Array; createContractV2?: { contractIdPreimage: { type: string; fromAddress?: { address: unknown } }; executable: { type: string; wasmHash?: unknown } } } };
  if (op.source && op.source !== tx.source) return null;
  const fn = op.func;
  if (fn.type === "hostFunctionTypeUploadContractWasm" && fn.wasm instanceof Uint8Array) {
    return Buffer.from(hash(Buffer.from(fn.wasm))).toString("hex") === NEXORA_TOKEN_WASM_HASH ? "upload" : null;
  }
  if (fn.type === "hostFunctionTypeCreateContractV2" && fn.createContractV2) {
    const c = fn.createContractV2;
    if (c.executable.type !== "contractExecutableWasm" || hex(c.executable.wasmHash) !== NEXORA_TOKEN_WASM_HASH) return null;
    if (c.contractIdPreimage.type !== "contractIdPreimageFromAddress" || !c.contractIdPreimage.fromAddress) return null;
    try { if (Address.fromScAddress(c.contractIdPreimage.fromAddress.address as never).toString() !== tx.source) return null; } catch { return null; }
    return "deploy";
  }
  return null;
}

/** Simulates and assembles a client-built NEXORA token upload/deploy transaction. */
export async function POST(request: NextRequest) {
  if (rateLimited(request, "soroban-prepare", 10)) return json({ error: "Too many requests." }, 429);
  let envelope = "";
  try { const body = await request.json() as { xdr?: unknown }; envelope = typeof body.xdr === "string" ? body.xdr.trim() : ""; } catch { return json({ error: "Invalid request." }, 400); }
  if (!envelope || envelope.length > 180_000) return json({ error: "Invalid request." }, 400);
  let tx: Transaction;
  try {
    const parsed = TransactionBuilder.fromXDR(envelope, Networks.PUBLIC);
    if (parsed instanceof FeeBumpTransaction || parsed.signatures.length > 0) return json({ error: "Invalid request." }, 400);
    tx = parsed as Transaction;
  } catch { return json({ error: "Invalid request." }, 400); }
  const kind = classify(tx);
  if (!kind) return json({ error: "Invalid request." }, 400);
  if (!(await ensureVerifiedMainnetRpc())) return json({ error: UNAVAILABLE, status: "soroban_unavailable" }, 503);

  try {
    const server = new rpc.Server(verifiedMainnetRpcUrl());
    const simulation = await server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(simulation)) {
      logServerError("stellar/soroban/prepare:simulation", new Error(JSON.stringify((simulation as { error?: unknown }).error ?? "simulation failed").slice(0, 800)));
      return json({ error: kind === "upload" ? "The token code couldn't be installed right now." : "This token can't be deployed with these settings. Check your XLM balance.", status: "simulation_failed" }, 422);
    }
    const prepared = rpc.assembleTransaction(tx, simulation).build();
    if (Number(prepared.fee) > (kind === "upload" ? UPLOAD_MAX_FEE_STROOPS : DEPLOY_MAX_FEE_STROOPS)) {
      return json({ error: "The network fee for this action is unusually high. Try again later." }, 409);
    }
    return json({ kind, xdr: prepared.toEnvelope().toXDR("base64"), fee: prepared.fee });
  } catch (error) {
    const requestId = logServerError("stellar/soroban/prepare", error);
    return json({ error: UNAVAILABLE, requestId }, 502);
  }
}
