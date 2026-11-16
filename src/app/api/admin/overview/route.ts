import { db } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route("admin:overview", async request => {
  await requireAdmin(request, "applications.read");
  const [byStatus, tokens, users, subs, pendingRedemptions, recent] = await Promise.all([
    db()`select status, count(*)::int as n from rwa_applications where status <> 'draft' group by status`,
    db()`select status, count(*)::int as n from rwa_token_configs group by status`,
    db()`select count(*)::int as n from app_users where realm = 'public'`,
    db()`select status, count(*)::int as n from rwa_subscriptions group by status`,
    db()`select count(*)::int as n from rwa_asset_events where kind in ('redemption_request','incident') and status in ('pending_review','acknowledged')`,
    db()`select action, target_id, new_status, created_at, actor_email from admin_audit_log order by id desc limit 8`
  ]);
  const map = (rows: Record<string, unknown>[]) => Object.fromEntries(rows.map(r => [r.status as string, r.n as number]));
  return json({
    applications: map(byStatus), tokens: map(tokens), subscriptions: map(subs),
    users: users[0].n, openItems: pendingRedemptions[0].n, recent
  });
});
