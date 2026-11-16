import { db } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Approved/suspended assets and their tokenization state. */
export const GET = route("admin:assets", async request => {
  await requireAdmin(request, "applications.read");
  const rows = await db()`select a.reference, a.status, a.asset_name, a.category, a.published, c.status as token_status, c.token_code, c.issuer_address,
      c.total_supply, c.issued_at, c.issued_tx_hash, c.authorization_expires_at,
      (select count(*)::int from rwa_subscriptions s where s.application_id = a.id and s.status = 'delivered') as holders,
      (select count(*)::int from rwa_asset_events e where e.application_id = a.id and e.status in ('pending_review','acknowledged')) as open_items
    from rwa_applications a left join rwa_token_configs c on c.application_id = a.id
    where a.status in ('approved','suspended') order by a.decided_at desc nulls last`;
  return json({ assets: rows });
});
