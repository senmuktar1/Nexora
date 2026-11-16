import { db } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Audit log, newest first, filterable by action prefix or target. Paged by id. */
export const GET = route("admin:audit", async request => {
  await requireAdmin(request, "audit.read");
  const p = request.nextUrl.searchParams;
  const action = (p.get("action") ?? "").trim().slice(0, 60) || null;
  const target = (p.get("target") ?? "").trim().slice(0, 120) || null;
  const before = Number(p.get("before")) || null;
  const rows = await db()`select id, actor_email, action, target_type, target_id, previous_status, new_status, reason, details, created_at from admin_audit_log
    where (${action}::text is null or action like ${(action ?? "") + "%"})
      and (${target}::text is null or target_id = ${target})
      and (${before}::bigint is null or id < ${before})
    order by id desc limit 100`;
  return json({ entries: rows, next: rows.length === 100 ? String(rows[rows.length - 1].id) : null });
});
