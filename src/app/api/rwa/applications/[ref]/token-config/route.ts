import { db } from "@/lib/server/db";
import { fail, json, readJson, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { ownedApplication, parseTokenConfig } from "@/lib/server/rwa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type P = { ref: string };

/** Saves the token configuration. Unlocked only after the application is approved. */
export const PUT = route<P>("rwa:token-config", async (request, { ref }) => {
  const session = await requireUser(request, { mutate: true });
  const app = await ownedApplication(ref, session.user.id);
  if (app.status !== "approved") return fail("Token configuration unlocks after the application is approved.", 409);
  const cfg = parseTokenConfig(await readJson(request));
  const rows = await db()`insert into rwa_token_configs ${db()({ application_id: app.id, ...cfg, status: "draft" } as Record<string, unknown>)}
    on conflict (application_id) do update set
      token_code = excluded.token_code, total_supply = excluded.total_supply, price_amount = excluded.price_amount, price_currency = excluded.price_currency,
      min_investment = excluded.min_investment, token_rights = excluded.token_rights, ownership_structure = excluded.ownership_structure,
      distribution_rules = excluded.distribution_rules, investor_eligibility = excluded.investor_eligibility, transfer_restrictions = excluded.transfer_restrictions,
      redemption_terms = excluded.redemption_terms, distributor_address = excluded.distributor_address, clawback_enabled = excluded.clawback_enabled, updated_at = now()
    where rwa_token_configs.status in ('draft','revoked')
    returning status`;
  if (!rows.length) return fail("The configuration is locked while it's submitted or authorised.", 409);
  return json({ ok: true, status: "draft" });
});

/** Submits the saved configuration for the final authorization review. */
export const POST = route<P>("rwa:token-config-submit", async (request, { ref }) => {
  const session = await requireUser(request, { mutate: true });
  const app = await ownedApplication(ref, session.user.id);
  if (app.status !== "approved") return fail("The application isn't approved.", 409);
  const body = await readJson(request);
  if (body.action !== "submit") return fail("Invalid request.");
  const rows = await db()`update rwa_token_configs set status = 'submitted', updated_at = now()
    where application_id = ${app.id as string} and status in ('draft','revoked') returning status`;
  if (!rows.length) return fail("Save the configuration first.", 409);
  await db()`insert into rwa_asset_events (application_id, kind, source, title, author_user_id) values (${app.id as string}, 'issuer_report', 'issuer', 'Token configuration submitted for authorization', ${session.user.id})`;
  return json({ ok: true, status: "submitted" });
});
