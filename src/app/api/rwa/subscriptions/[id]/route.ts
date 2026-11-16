import { db } from "@/lib/server/db";
import { fail, json, readJson, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Investor cancels a request before the issuer authorises it on-chain. */
export const POST = route<{ id: string }>("rwa:subscription-cancel", async (request, { id }) => {
  const session = await requireUser(request, { mutate: true });
  const body = await readJson(request);
  if (body.action !== "cancel" || !/^[0-9a-f-]{36}$/.test(id)) return fail("Invalid request.");
  const rows = await db()`update rwa_subscriptions set status = 'cancelled', updated_at = now()
    where id = ${id} and investor_user_id = ${session.user.id} and status in ('requested','accepted') returning id`;
  if (!rows.length) return fail("This request can't be cancelled.", 409);
  return json({ ok: true });
});
