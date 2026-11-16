import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/server/db";
import { fail, json, readJson, route } from "@/lib/server/http";
import { rateLimited } from "@/lib/server/rate-limit";
import { requireUser } from "@/lib/server/auth/guard";
import { getSettings } from "@/lib/server/settings";
import { findApplication, sameAmount } from "@/lib/server/rwa";
import { publicOffering } from "@/lib/server/rwa-views";
import { AMOUNT_PATTERN } from "@/lib/rwa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const units = (v: unknown) => Number(v);

/** An investor asks to subscribe. Nothing moves on-chain until the issuer accepts and authorises. */
export const POST = route<{ ref: string }>("rwa:subscribe", async (request, { ref }) => {
  const session = await requireUser(request, { mutate: true });
  if (rateLimited(request, "rwa-subscribe", 10, 10 * 60_000)) return fail("Too many requests. Try again shortly.", 429);
  const app = await findApplication(ref);
  const offering = app ? await publicOffering(app) : null;
  if (!app || !offering) return fail("Offering not found.", 404);
  if (!(await getSettings()).subscriptionsOpen) return fail("Subscriptions are not open on NEXORA at the moment.", 403);
  if (app.owner_user_id === session.user.id) return fail("Issuers can't subscribe to their own offering.", 400);
  const body = await readJson(request);
  const amount = String(body.amount ?? "").trim();
  const token = offering.token as Record<string, unknown>;
  if (!AMOUNT_PATTERN.test(amount) || !(units(amount) > 0)) return fail("Enter the number of tokens.");
  if (units(amount) < units(token.min_investment) && !sameAmount(amount, token.min_investment)) return fail(`The minimum subscription is ${token.min_investment} tokens.`);
  if (units(amount) > units(token.total_supply)) return fail("That's more than the total supply.");
  const address = String(body.investorAddress ?? "").trim();
  if (!StrKey.isValidEd25519PublicKey(address)) return fail("Enter your Stellar wallet address.");
  if (body.eligibilityAttested !== true || body.risksAcknowledged !== true) return fail("Confirm your eligibility and that you've read the risks.");
  const open = await db()`select 1 from rwa_subscriptions where application_id = ${app.id as string} and investor_user_id = ${session.user.id} and status in ('requested','accepted','authorized')`;
  if (open.length) return fail("You already have an open request for this offering.", 409);
  const rows = await db()`insert into rwa_subscriptions (application_id, investor_user_id, investor_address, amount, eligibility_attested)
    values (${app.id as string}, ${session.user.id}, ${address}, ${amount}, true) returning id, status, amount, investor_address, created_at`;
  return json({ subscription: rows[0] }, 201);
});
