import { db } from "@/lib/server/db";
import { fail, json, readJson, route } from "@/lib/server/http";
import { rateLimited } from "@/lib/server/rate-limit";
import { requireUser } from "@/lib/server/auth/guard";
import { audit } from "@/lib/server/audit";
import { ownedApplication, recordOnChainStep, txHashAlreadyUsed, verifyIssuance } from "@/lib/server/rwa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Records the issuance after checking the confirmed Stellar transaction against the
 * authorised configuration (issuer flags, code, supply, recipient, unlocked issuer).
 */
export const POST = route<{ ref: string }>("rwa:issuance", async (request, { ref }) => {
  const session = await requireUser(request, { mutate: true });
  if (rateLimited(request, "rwa-issuance", 10)) return fail("Too many attempts. Try again shortly.", 429);
  const app = await ownedApplication(ref, session.user.id);
  if (app.status !== "approved") return fail("The application isn't approved.", 409);
  const cfgRows = await db()`select * from rwa_token_configs where application_id = ${app.id as string}`;
  const cfg = cfgRows[0];
  if (!cfg || cfg.status !== "authorized") return fail("Issuance hasn't been authorised.", 409);
  if (!cfg.authorization_expires_at || new Date(cfg.authorization_expires_at as string).getTime() < Date.now()) return fail("The issuance authorization has expired. Ask NEXORA to re-authorise.", 409);
  const body = await readJson(request);
  if (await txHashAlreadyUsed(body.txHash)) return fail("This transaction was already recorded.", 409);
  const { issuer, hash } = await verifyIssuance(body.txHash, cfg);
  // Hash reservation, status change, event and audit entry commit together or not at all.
  await recordOnChainStep(hash, "issuance", { applicationId: app.id as string }, async tx => {
    const updated = await tx`update rwa_token_configs set status = 'issued', issuer_address = ${issuer}, issued_tx_hash = ${hash}, issued_at = now(), updated_at = now()
      where application_id = ${app.id as string} and status = 'authorized' returning status`;
    if (!updated.length) return false;
    await tx`insert into rwa_asset_events (application_id, kind, source, title, body, tx_hash, public, author_user_id)
      values (${app.id as string}, 'status_change', 'on_chain', 'Token issued on Stellar', ${`${cfg.token_code}:${issuer}`}, ${hash}, true, ${session.user.id})`;
    await audit({ actor: { id: session.user.id, email: session.user.email }, action: "rwa.token.issued", targetType: "rwa_application", targetId: ref, previousStatus: "authorized", newStatus: "issued", details: { issuer, txHash: hash } }, tx);
    return true;
  }, "This issuance was already recorded.");
  return json({ ok: true, issuer, txHash: hash });
});
