import { db } from "@/lib/server/db";
import { fail, json, route } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/auth/guard";
import { adminApplication, horizon } from "@/lib/server/rwa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

/** Live on-chain state of an issued token (Horizon), for monitoring. */
export const GET = route<{ ref: string }>("admin:asset-onchain", async (request, { ref }) => {
  await requireAdmin(request, "applications.read");
  const app = await adminApplication(ref);
  const cfg = (await db()`select token_code, issuer_address, total_supply from rwa_token_configs where application_id = ${app.id as string} and status = 'issued'`)[0];
  if (!cfg) return fail("This token hasn't been issued.", 404);
  const code = cfg.token_code as string, issuer = cfg.issuer_address as string;
  const [account, assets] = await Promise.all([
    horizon(`/accounts/${issuer}`),
    horizon(`/assets?asset_code=${encodeURIComponent(code)}&asset_issuer=${issuer}&limit=1`)
  ]);
  const asset = ((assets?._embedded as Record<string, unknown> | undefined)?.records as Record<string, unknown>[] | undefined)?.[0] ?? null;
  const flags = (account?.flags ?? {}) as Record<string, unknown>;
  const signers = (account?.signers as { key: string; weight: number }[] | undefined) ?? [];
  return json({
    onChain: {
      issuerExists: !!account,
      authRequired: flags.auth_required === true,
      authRevocable: flags.auth_revocable === true,
      clawbackEnabled: flags.auth_clawback_enabled === true,
      issuerMasterWeight: signers.find(s => s.key === issuer)?.weight ?? null,
      accounts: asset ? (asset.accounts as Record<string, number> | undefined) ?? null : null,
      balances: asset ? (asset.balances as Record<string, string> | undefined) ?? null : null,
      configuredSupply: cfg.total_supply
    }
  });
});
