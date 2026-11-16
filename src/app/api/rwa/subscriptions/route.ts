import { db } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The signed-in investor's subscriptions across offerings. */
export const GET = route("rwa:my-subscriptions", async request => {
  const session = await requireUser(request, { verified: false });
  const rows = await db()`select s.id, s.investor_address, s.amount, s.status, s.authorize_tx_hash, s.delivery_tx_hash, s.decision_reason, s.created_at,
      a.reference, a.asset_name, c.token_code, c.issuer_address
    from rwa_subscriptions s join rwa_applications a on a.id = s.application_id left join rwa_token_configs c on c.application_id = a.id
    where s.investor_user_id = ${session.user.id} order by s.created_at desc`;
  return json({ subscriptions: rows });
});
