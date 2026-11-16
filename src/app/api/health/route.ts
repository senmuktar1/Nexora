import { NextRequest, NextResponse } from "next/server";
import { Networks } from "@stellar/stellar-sdk";
import { HORIZON } from "@/lib/server/horizon";
import { ensureVerifiedMainnetRpc, sorobanStatus } from "@/lib/server/soroban";
import { db, dbConfigured } from "@/lib/server/db";
import { encryptionConfigured } from "@/lib/server/crypto";
import { emailMode } from "@/lib/server/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/health          → liveness (no external calls; use for platform health checks)
 * GET /api/health?deep=1   → readiness: Horizon reachable on Mainnet, Soroban RPC verified,
 *                            optional provider keys present, and the accounts/RWA/admin backend
 *                            (database reachable + migrated, encryption, email, admin host/email
 *                            configured, bootstrap done). Booleans only — never URLs, keys or emails.
 */
async function platformStatus() {
  const database = { configured: dbConfigured(), reachable: false, migrated: false };
  let bootstrapCompleted = false;
  if (database.configured) {
    try {
      const rows = await Promise.race([
        db()`select (select count(*)::int from schema_migrations where name in ('0001_init.sql', '0002_tx_hash_uniqueness.sql')) as m, (select count(*)::int from admin_bootstrap) as b`,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))
      ]);
      database.reachable = true;
      database.migrated = rows[0].m === 2;
      bootstrapCompleted = rows[0].b === 1;
    } catch (e) {
      database.reachable = !/timeout|ECONNREFUSED|ENOTFOUND|password|authentication/i.test(String(e));
    }
  }
  return {
    database,
    encryption: encryptionConfigured(),
    email: emailMode() === "resend" ? "configured" : emailMode() === "test-outbox" ? "test-outbox" : "missing",
    admin: { host: Boolean(process.env.ADMIN_HOST?.trim()), email: Boolean(process.env.NEXORA_ADMIN_EMAIL?.trim()), bootstrapCompleted }
  };
}
export async function GET(request: NextRequest) {
  const base = { ok: true, app: "NEXORA", network: "mainnet", timestamp: new Date().toISOString() };
  if (request.nextUrl.searchParams.get("deep") !== "1") return NextResponse.json(base, { headers: { "Cache-Control": "no-store" } });

  let horizon = { reachable: false, mainnet: false };
  try {
    const response = await fetch(HORIZON, { cache: "no-store", signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
    const root = response.ok ? await response.json() as { network_passphrase?: string } : null;
    horizon = { reachable: response.ok, mainnet: root?.network_passphrase === Networks.PUBLIC };
  } catch { /* unreachable */ }
  await ensureVerifiedMainnetRpc();
  const soroban = sorobanStatus();
  const providers = { stellarExpertKey: Boolean(process.env.STELLAR_EXPERT_API_KEY?.trim()), defindexKey: Boolean(process.env.DEFINDEX_API_KEY?.trim()) };
  const ready = horizon.reachable && horizon.mainnet;
  const platform = await platformStatus();
  return NextResponse.json({ ...base, ok: ready, horizon, soroban, providers, platform }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
