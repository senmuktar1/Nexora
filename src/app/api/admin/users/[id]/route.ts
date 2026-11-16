import { db } from "@/lib/server/db";
import { fail, json, readJson, route, str } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/auth/guard";
import { audit } from "@/lib/server/audit";
import { destroyUserSessions } from "@/lib/server/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Suspends or reactivates an account. The Super Admin account can't be changed here. */
export const POST = route<{ id: string }>("admin:user", async (request, { id }) => {
  const session = await requireAdmin(request, "users.manage", { mutate: true });
  if (!/^[0-9a-f-]{36}$/.test(id)) return fail("Account not found.", 404);
  const body = await readJson(request);
  const reason = str(body.reason, 1000);
  if (body.action !== "suspend" && body.action !== "reactivate") return fail("Invalid action.");
  if (reason.length < 5) return fail("Record the reason.");
  const user = (await db()`select id, email, role, status, email_verified_at from app_users where id = ${id}`)[0];
  if (!user) return fail("Account not found.", 404);
  if (user.role === "super_admin" || user.id === session.user.id) return fail("This account can't be changed here.", 403);
  const to = body.action === "suspend" ? "suspended" : user.email_verified_at ? "active" : "pending";
  const rows = await db()`update app_users set status = ${to}, updated_at = now() where id = ${id} and status = ${user.status as string} returning id`;
  if (!rows.length) return fail("The account changed in the meantime. Reload and try again.", 409);
  if (to === "suspended") await destroyUserSessions(id);
  await audit({ actor: { id: session.user.id, email: session.user.email }, action: `user.${body.action}`, targetType: "user", targetId: user.email as string, previousStatus: user.status as string, newStatus: to, reason });
  return json({ ok: true, status: to });
});
