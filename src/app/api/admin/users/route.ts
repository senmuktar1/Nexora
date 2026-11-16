import { db } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Public accounts (applicants/issuers and investors) and admin staff accounts. */
export const GET = route("admin:users", async request => {
  await requireAdmin(request, "users.read");
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  const like = q ? `%${q.replace(/[%_\\]/g, m => "\\" + m)}%` : null;
  const rows = await db()`select u.id, u.realm, u.email, u.role, u.status, u.email_verified_at, u.mfa_enabled, u.stellar_address, u.created_at, u.last_login_at,
      (select count(*)::int from rwa_applications a where a.owner_user_id = u.id and a.status <> 'draft') as applications,
      (select count(*)::int from rwa_applications a where a.owner_user_id = u.id and a.status = 'approved') as approved_assets,
      (select count(*)::int from rwa_subscriptions s where s.investor_user_id = u.id) as subscriptions
    from app_users u where (${like}::text is null or u.email ilike ${like} or u.stellar_address ilike ${like})
    order by u.realm, u.created_at desc limit 500`;
  return json({ users: rows });
});
