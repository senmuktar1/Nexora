import { db } from "@/lib/server/db";
import { fail, json, readJson, route, str } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/auth/guard";
import { audit } from "@/lib/server/audit";
import { adminApplication } from "@/lib/server/rwa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Lists or unlists an issued offering on the public RWA explorer. */
export const POST = route<{ ref: string }>("admin:publish", async (request, { ref }) => {
  const session = await requireAdmin(request, "assets.manage", { mutate: true });
  const app = await adminApplication(ref);
  const body = await readJson(request);
  if (typeof body.published !== "boolean") return fail("Invalid request.");
  const reason = str(body.reason, 1000);
  if (body.published) {
    const cfg = await db()`select status from rwa_token_configs where application_id = ${app.id as string}`;
    if (app.status !== "approved" || cfg[0]?.status !== "issued") return fail("Only approved offerings whose token issuance was verified can be listed.", 409);
  } else if (reason.length < 5) return fail("Record the reason for unlisting.");
  await db()`update rwa_applications set published = ${body.published}, updated_at = now() where id = ${app.id as string}`;
  await audit({ actor: { id: session.user.id, email: session.user.email }, action: body.published ? "rwa.offering.listed" : "rwa.offering.unlisted", targetType: "rwa_application", targetId: ref, reason: reason || null });
  return json({ ok: true, published: body.published });
});
