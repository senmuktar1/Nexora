import { db } from "@/lib/server/db";
import { fail, json, readJson, route } from "@/lib/server/http";
import { rateLimited } from "@/lib/server/rate-limit";
import { requireUser } from "@/lib/server/auth/guard";
import { ownedApplication } from "@/lib/server/rwa";
import { recordEvent } from "@/lib/server/rwa-events";
import { ISSUER_EVENT_KINDS } from "@/lib/rwa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type P = { ref: string };

/** Issuer lifecycle reporting (valuations, custody, insurance, revenue, distributions, incidents…). */
export const POST = route<P>("rwa:event", async (request, { ref }) => {
  const session = await requireUser(request, { mutate: true });
  if (rateLimited(request, "rwa-event", 30, 10 * 60_000)) return fail("Too many records. Try again shortly.", 429);
  const app = await ownedApplication(ref, session.user.id);
  if (app.status !== "approved" && app.status !== "suspended") return fail("Lifecycle records start after approval.", 409);
  const event = await recordEvent(request, app, { id: session.user.id, email: session.user.email }, "issuer", ISSUER_EVENT_KINDS);
  return json({ event }, 201);
});

/** Issuer responds to an investor's redemption request. */
export const PATCH = route<P>("rwa:event-status", async (request, { ref }) => {
  const session = await requireUser(request, { mutate: true });
  const app = await ownedApplication(ref, session.user.id);
  const body = await readJson(request);
  const status = body.status;
  if (status !== "acknowledged" && status !== "resolved" && status !== "rejected") return fail("Invalid status.");
  const rows = await db()`update rwa_asset_events set status = ${status}
    where id = ${Number(body.eventId) || 0} and application_id = ${app.id as string} and kind = 'redemption_request' and status in ('pending_review','acknowledged') returning id`;
  if (!rows.length) return fail("Request not found or already closed.", 404);
  return json({ ok: true });
});
