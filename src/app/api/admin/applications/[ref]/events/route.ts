import { db } from "@/lib/server/db";
import { fail, json, readJson, route } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/auth/guard";
import { audit } from "@/lib/server/audit";
import { adminApplication } from "@/lib/server/rwa";
import { recordEvent } from "@/lib/server/rwa-events";
import { EVENT_KINDS, type EventKind } from "@/lib/rwa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type P = { ref: string };
const ADMIN_KINDS = (Object.keys(EVENT_KINDS) as EventKind[]).filter(k => k !== "redemption_request" && k !== "status_change");

/** NEXORA records a lifecycle item (inspection, incident, valuation review…). */
export const POST = route<P>("admin:event", async (request, { ref }) => {
  const session = await requireAdmin(request, "lifecycle.manage", { mutate: true });
  const app = await adminApplication(ref);
  if (app.status !== "approved" && app.status !== "suspended") return fail("Lifecycle records start after approval.", 409);
  const event = await recordEvent(request, app, { id: session.user.id, email: session.user.email }, "admin", ADMIN_KINDS);
  await audit({ actor: { id: session.user.id, email: session.user.email }, action: "rwa.lifecycle.recorded", targetType: "rwa_application", targetId: ref, details: { kind: event.kind, eventId: String(event.id) } });
  return json({ event }, 201);
});

/** Updates review status / visibility of a lifecycle item. */
export const PATCH = route<P>("admin:event-update", async (request, { ref }) => {
  const session = await requireAdmin(request, "lifecycle.manage", { mutate: true });
  const app = await adminApplication(ref);
  const body = await readJson(request);
  const id = Number(body.eventId) || 0;
  const status = body.status === undefined ? null : String(body.status);
  if (status !== null && !["recorded", "pending_review", "acknowledged", "resolved", "rejected"].includes(status)) return fail("Invalid status.");
  const visible = typeof body.public === "boolean" ? body.public : null;
  const rows = await db()`update rwa_asset_events set status = coalesce(${status}::text, status), public = coalesce(${visible}::boolean, public)
    where id = ${id} and application_id = ${app.id as string} and kind <> 'status_change' returning id, status, public`;
  if (!rows.length) return fail("Record not found.", 404);
  await audit({ actor: { id: session.user.id, email: session.user.email }, action: "rwa.lifecycle.updated", targetType: "rwa_application", targetId: ref, newStatus: rows[0].status as string, details: { eventId: id, public: rows[0].public } });
  return json({ ok: true });
});
