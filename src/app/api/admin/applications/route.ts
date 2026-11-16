import { db } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/auth/guard";
import { RWA_STATUSES } from "@/lib/rwa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Applications in review queues (drafts stay private to the applicant). */
export const GET = route("admin:applications", async request => {
  await requireAdmin(request, "applications.read");
  const status = request.nextUrl.searchParams.get("status") ?? "";
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  const filter = status in RWA_STATUSES && status !== "draft" ? status : null;
  const like = q ? `%${q.replace(/[%_\\]/g, m => "\\" + m)}%` : null;
  const rows = await db()`select a.reference, a.status, a.category, a.asset_name, a.issuer_legal_name, a.country, a.submitted_at, a.updated_at, a.published,
      u.email as owner_email, c.status as token_status
    from rwa_applications a join app_users u on u.id = a.owner_user_id left join rwa_token_configs c on c.application_id = a.id
    where a.status <> 'draft'
      and (${filter}::text is null or a.status = ${filter})
      and (${like}::text is null or a.reference ilike ${like} or a.asset_name ilike ${like} or a.issuer_legal_name ilike ${like} or u.email ilike ${like})
    order by a.submitted_at desc nulls last limit 300`;
  return json({ applications: rows });
});
