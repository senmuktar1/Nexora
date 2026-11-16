import { db, dbConfigured } from "@/lib/server/db";
import { fail, isAdminHost, json, route } from "@/lib/server/http";
import { getSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Published offerings: approved by NEXORA, authorised, issued on Stellar and listed by an admin. */
export const GET = route("rwa:offerings", async request => {
  if (isAdminHost(request.headers.get("host"))) return fail("Not found.", 404);
  if (!dbConfigured()) return json({ available: false, offerings: [] });
  const rows = await db()`select a.reference, a.category, a.asset_name, a.country, a.issuer_legal_name, a.valuation_amount, a.valuation_currency, a.valuation_date,
      c.token_code, c.issuer_address, c.total_supply, c.price_amount, c.price_currency, c.min_investment, c.issued_at
    from rwa_applications a join rwa_token_configs c on c.application_id = a.id
    where a.published and a.status = 'approved' and c.status = 'issued' order by c.issued_at desc limit 200`;
  const settings = await getSettings();
  return json({ available: true, subscriptionsOpen: settings.subscriptionsOpen, offerings: rows });
});
