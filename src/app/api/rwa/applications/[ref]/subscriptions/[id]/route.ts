import { db } from "@/lib/server/db";
import { fail, json, readJson, route, str } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { ownedApplication, recordOnChainStep, txHashAlreadyUsed, verifyDelivery, verifyTrustlineAuthorization } from "@/lib/server/rwa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Issuer handles a subscription request:
 *   accept / reject → authorized (trustline authorised on-chain) → delivered (tokens paid on-chain).
 * On-chain steps are recorded only after the transaction is verified on Stellar.
 */
export const POST = route<{ ref: string; id: string }>("rwa:subscription-issuer", async (request, { ref, id }) => {
  const session = await requireUser(request, { mutate: true });
  const app = await ownedApplication(ref, session.user.id);
  if (!/^[0-9a-f-]{36}$/.test(id)) return fail("Subscription not found.", 404);
  const rows = await db()`select * from rwa_subscriptions where id = ${id} and application_id = ${app.id as string}`;
  const sub = rows[0];
  if (!sub) return fail("Subscription not found.", 404);
  const body = await readJson(request);
  const action = body.action;
  const cfg = (await db()`select * from rwa_token_configs where application_id = ${app.id as string}`)[0];
  const active = app.status === "approved" && cfg?.status === "issued";

  const move = async (from: string[], to: string, extra: Record<string, unknown> = {}) => {
    const set = { status: to, updated_at: new Date(), ...extra };
    const done = await db()`update rwa_subscriptions set ${db()(set as Record<string, unknown>, ...Object.keys(set))} where id = ${id} and status = any(${from}) returning id`;
    if (!done.length) return fail("This request changed in the meantime. Reload and try again.", 409);
    return json({ ok: true, status: to });
  };

  if (action === "reject") {
    const reason = str(body.reason, 1000);
    if (reason.length < 3) return fail("Give a reason for the investor.");
    return move(["requested", "accepted"], "rejected", { decision_reason: reason });
  }
  if (!active) return fail("The offering isn't active.", 409);
  if (action === "accept") return move(["requested"], "accepted");
  const expected = { distributor: cfg.distributor_address as string, issuer: cfg.issuer_address as string, code: cfg.token_code as string, investor: sub.investor_address as string };
  if ((action === "authorized" || action === "delivered") && await txHashAlreadyUsed(body.txHash)) return fail("This transaction was already recorded for another step.", 409);
  if (action === "authorized") {
    if (sub.status !== "accepted") return fail("Accept the request first.", 409);
    const hash = await verifyTrustlineAuthorization(body.txHash, expected);
    await recordOnChainStep(hash, "authorization", { applicationId: app.id as string, subscriptionId: id }, async tx =>
      (await tx`update rwa_subscriptions set status = 'authorized', authorize_tx_hash = ${hash}, updated_at = now() where id = ${id} and status = 'accepted' returning id`).length > 0);
    return json({ ok: true, status: "authorized" });
  }
  if (action === "delivered") {
    if (sub.status !== "authorized") return fail("Authorise the investor's trustline first.", 409);
    const hash = await verifyDelivery(body.txHash, { ...expected, amount: String(sub.amount) });
    await recordOnChainStep(hash, "delivery", { applicationId: app.id as string, subscriptionId: id }, async tx =>
      (await tx`update rwa_subscriptions set status = 'delivered', delivery_tx_hash = ${hash}, updated_at = now() where id = ${id} and status = 'authorized' returning id`).length > 0);
    return json({ ok: true, status: "delivered" });
  }
  return fail("Invalid request.");
});
