import { db } from "@/lib/server/db";
import { fail, json, route } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/auth/guard";
import { getSettings } from "@/lib/server/settings";
import { adminApplication, authorizationChecklist, legalClearanceEvidence } from "@/lib/server/rwa";
import { ownerView } from "@/lib/server/rwa-views";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Full review record for an application. */
export const GET = route<{ ref: string }>("admin:application", async (request, { ref }) => {
  const session = await requireAdmin(request, "applications.read");
  const app = await adminApplication(ref);
  if (app.status === "draft") return fail("Application not found.", 404);
  const [view, owner, findings, cfgRow, settings] = await Promise.all([
    ownerView(app),
    db()`select email, status, created_at, stellar_address from app_users where id = ${app.owner_user_id as string}`,
    db()`select f.id, f.kind, f.subject, f.evidence_status, f.document_id, f.body, f.created_at, u.email as author_email
      from rwa_findings f join app_users u on u.id = f.author_user_id where f.application_id = ${app.id as string} order by f.created_at desc`,
    db()`select * from rwa_token_configs where application_id = ${app.id as string}`,
    getSettings()
  ]);
  const historyWithActors = await db()`select h.from_status, h.to_status, h.reason, h.created_at, u.email as actor_email, u.realm as actor_realm
    from rwa_status_history h left join app_users u on u.id = h.actor_user_id where h.application_id = ${app.id as string} order by h.created_at`;
  const checklist = await authorizationChecklist(app, cfgRow[0] ?? null, settings);
  const legalClearanceDocuments = (await legalClearanceEvidence(app.id as string)).map(d => ({ id: d.id, filename: d.filename, verified_at: d.verified_at }));
  return json({
    ...view,
    history: historyWithActors,
    owner: owner[0] ?? null,
    findings,
    tokenAuthorization: cfgRow[0] ? { legal_clearance: cfgRow[0].legal_clearance, authorized_at: cfgRow[0].authorized_at, authorization_expires_at: cfgRow[0].authorization_expires_at } : null,
    checklist: checklist.filter(c => c.source === "system"),
    legalClearanceDocuments,
    settings: { requireClawback: settings.requireClawback, authorizationValidityDays: settings.authorizationValidityDays },
    viewer: { email: session.user.email, role: session.user.role }
  });
});
