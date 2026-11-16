import { db } from "@/lib/server/db";
import { fail, json, readJson, route, str } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/auth/guard";
import { audit } from "@/lib/server/audit";
import { getSettings } from "@/lib/server/settings";
import { adminApplication, authorizationChecklist, legalClearanceEvidence } from "@/lib/server/rwa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Final tokenization authorization — separate from approval. Every checklist item
 * (system checks + reviewer confirmations) must pass. Authorization only permits the
 * issuer to issue from their own wallet; NEXORA never deploys or signs anything.
 *   authorize     submitted → authorized (expires after the configured number of days)
 *   return        submitted → draft (changes requested)
 *   revoke        authorized → revoked (before issuance)
 */
export const POST = route<{ ref: string }>("admin:tokenization", async (request, { ref }) => {
  const session = await requireAdmin(request, "tokenization.authorize", { mutate: true });
  const app = await adminApplication(ref);
  const body = await readJson(request);
  const actor = { id: session.user.id, email: session.user.email };
  const cfg = (await db()`select * from rwa_token_configs where application_id = ${app.id as string}`)[0];
  if (!cfg) return fail("The issuer hasn't configured the token yet.", 409);

  if (body.action === "return" || body.action === "revoke") {
    const reason = str(body.reason, 2000);
    if (reason.length < 5) return fail("Record the reason.");
    const from = body.action === "return" ? "submitted" : "authorized";
    const to = body.action === "return" ? "draft" : "revoked";
    const rows = await db()`update rwa_token_configs set status = ${to}, authorized_by = null, authorized_at = null, authorization_expires_at = null, updated_at = now()
      where application_id = ${app.id as string} and status = ${from} returning status`;
    if (!rows.length) return fail("This action isn't available in the current state.", 409);
    await audit({ actor, action: `rwa.tokenization.${body.action}`, targetType: "rwa_application", targetId: ref, previousStatus: from, newStatus: to, reason });
    return json({ ok: true, status: to });
  }

  if (body.action !== "authorize") return fail("Invalid action.");
  const settings = await getSettings();
  const confirmations = {
    legalClearanceRef: str(body.legalClearanceRef, 300),
    legalClearanceDocumentId: str(body.legalClearanceDocumentId, 40),
    configMatchesOffering: body.configMatchesOffering === true,
    issuerAuthorized: body.issuerAuthorized === true,
    authorizeDeployment: body.authorizeDeployment === true
  };
  const checklist = await authorizationChecklist(app, cfg, settings, confirmations);
  const missing = checklist.filter(c => !c.ok);
  if (missing.length) return json({ error: "Authorization requirements aren't met.", missing: missing.map(m => m.label) }, 400);
  const expires = new Date(Date.now() + settings.authorizationValidityDays * 86_400_000);
  const evidence = (await legalClearanceEvidence(app.id as string)).find(d => d.id === confirmations.legalClearanceDocumentId)!;
  const clearance = {
    document: { id: String(evidence.id), filename: String(evidence.filename), sha256: String(evidence.sha256), verifiedFindingId: String(evidence.finding_id), verifiedAt: String(evidence.verified_at) },
    reference: confirmations.legalClearanceRef, recordedBy: session.user.email, recordedAt: new Date().toISOString(), checklist: checklist.map(c => c.key) };
  const rows = await db()`update rwa_token_configs set status = 'authorized', authorized_by = ${session.user.id}, authorized_at = now(),
      authorization_expires_at = ${expires}, legal_clearance = ${db().json(clearance)}, updated_at = now()
    where application_id = ${app.id as string} and status = 'submitted' returning status`;
  if (!rows.length) return fail("The configuration changed in the meantime. Reload and try again.", 409);
  await audit({ actor, action: "rwa.tokenization.authorized", targetType: "rwa_application", targetId: ref, previousStatus: "submitted", newStatus: "authorized",
    reason: confirmations.legalClearanceRef, details: { tokenCode: cfg.token_code, totalSupply: cfg.total_supply, expiresAt: expires.toISOString(), legalClearanceDocumentId: String(evidence.id), legalClearanceSha256: String(evidence.sha256) } });
  return json({ ok: true, status: "authorized", expiresAt: expires.toISOString() });
});
