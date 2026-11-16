import { fail, json, readJson, route, str } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/auth/guard";
import { ADMIN_ACTIONS, adminApplication, transition, type AdminAction } from "@/lib/server/rwa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Review decisions: start review, request information, approve, reject, suspend, reinstate.
 * Each decision is recorded with reference, admin identity, action, time, reason and the
 * previous/new status (status history + audit log, in one transaction).
 */
export const POST = route<{ ref: string }>("admin:decision", async (request, { ref }) => {
  const body = await readJson(request);
  const action = body.action as AdminAction;
  if (typeof action !== "string" || !(action in ADMIN_ACTIONS)) return fail("Invalid action.");
  const session = await requireAdmin(request, action === "start_review" || action === "request_info" ? "applications.review" : "applications.decide", { mutate: true });
  const rule = ADMIN_ACTIONS[action];
  const reason = str(body.reason, 4000);
  if (rule.reason && reason.length < 5) return fail(action === "request_info" ? "Describe what information is needed." : "Record the reason for this decision.");
  const app = await adminApplication(ref);
  if (!(rule.from as readonly string[]).includes(app.status as string)) return fail(`This action isn't available while the application is “${String(app.status).replace("_", " ")}”.`, 409);
  await transition(app, rule.to, { id: session.user.id, email: session.user.email }, reason || null, { admin: true, action, infoRequest: action === "request_info" ? reason : null });
  return json({ ok: true, status: rule.to });
});
