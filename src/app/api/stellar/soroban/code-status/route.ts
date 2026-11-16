import { NextResponse } from "next/server";
import { Buffer } from "buffer";
import { rpc, xdr } from "@stellar/stellar-sdk";
import { logServerError, UNAVAILABLE } from "@/lib/server/errors";
import { ensureVerifiedMainnetRpc, verifiedMainnetRpcUrl } from "@/lib/server/soroban";
import { NEXORA_TOKEN_WASM_HASH } from "@/lib/stellar/soroban-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };

/** Whether the NEXORA token contract code is already installed on Mainnet (then no upload is needed). */
export async function GET() {
  if (!(await ensureVerifiedMainnetRpc())) return NextResponse.json({ error: UNAVAILABLE, status: "soroban_unavailable" }, { status: 503, headers: NO_STORE });
  try {
    const key = xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: Buffer.from(NEXORA_TOKEN_WASM_HASH, "hex") as never }));
    const result = await new rpc.Server(verifiedMainnetRpcUrl()).getLedgerEntries(key);
    return NextResponse.json({ wasmHash: NEXORA_TOKEN_WASM_HASH, installed: result.entries.length > 0 }, { headers: NO_STORE });
  } catch (error) {
    const requestId = logServerError("stellar/soroban/code-status", error);
    return NextResponse.json({ error: UNAVAILABLE, requestId }, { status: 502, headers: NO_STORE });
  }
}
