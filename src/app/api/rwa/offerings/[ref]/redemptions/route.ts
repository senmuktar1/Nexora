import { db } from "@/lib/server/db";
import { fail, json, readJson, route, str } from "@/lib/server/http";
import { rateLimited } from "@/lib/server/rate-limit";
import { requireUser } from "@/lib/server/auth/guard";
import { findApplication } from "@/lib/server/rwa";
import { AMOUNT_PATTERN } from "@/lib/rwa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** A holder (delivered subscription) asks the issuer to redeem under the offering's terms. */
export const POST = route<{ ref: string }>("rwa:redeem", async (request, { ref }) => {
  const session = await requireUser(request, { mutate: true });
  if (rateLimited(request, "rwa-redeem", 5, 3_600_000)) return fail("Too many requests. Try again later.", 429);
  const app = await findApplication(ref);
  if (!app) return fail("Offering not found.", 404);
  const held = await db()`select investor_address from rwa_subscriptions where application_id = ${app.id as string} and investor_user_id = ${session.user.id} and status = 'delivered' limit 1`;
  if (!held.length) return fail("Only investors who received tokens can request redemption.", 403);
  const body = await readJson(request);
  const amount = String(body.amount ?? "").trim();
  if (!AMOUNT_PATTERN.test(amount) || !(Number(amount) > 0)) return fail("Enter the number of tokens to redeem.");
  const details = str(body.details, 2000);
  await db()`insert into rwa_asset_events (application_id, kind, source, title, body, amount, status, author_user_id)
    values (${app.id as string}, 'redemption_request', 'investor', ${`Redemption request from ${held[0].investor_address as string}`}, ${details}, ${amount}, 'pending_review', ${session.user.id})`;
  return json({ ok: true }, 201);
});
