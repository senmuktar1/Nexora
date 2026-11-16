import { db } from "@/lib/server/db";
import { fail, json, readJson, route, str } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/auth/guard";
import { audit } from "@/lib/server/audit";
import { adminApplication } from "@/lib/server/rwa";
import { EVIDENCE_STATUS, FINDING_SUBJECTS } from "@/lib/rwa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Verification findings (subject + evidence status: issuer declaration / verified / could
 * not verify, optionally tied to a document) and internal notes. Append-only.
 */
export const POST = route<{ ref: string }>("admin:finding", async (request, { ref }) => {
  const session = await requireAdmin(request, "findings.write", { mutate: true });
  const app = await adminApplication(ref);
  if (app.status === "draft") return fail("Application not found.", 404);
  const body = await readJson(request);
  const kind = body.kind === "note" ? "note" : body.kind === "finding" ? "finding" : null;
  if (!kind) return fail("Invalid request.");
  const text = str(body.body, 4000);
  if (text.length < 3) return fail("Write the finding or note.");
  let subject = "", evidence: string | null = null, documentId: string | null = null;
  if (kind === "finding") {
    subject = String(body.subject ?? "");
    evidence = String(body.evidenceStatus ?? "");
    if (!(subject in FINDING_SUBJECTS) || !(evidence in EVIDENCE_STATUS)) return fail("Choose the subject and evidence status.");
    if (body.documentId) {
      const doc = await db()`select id, kind from rwa_documents where id = ${String(body.documentId)}::uuid and application_id = ${app.id as string}`.catch(() => []);
      if (!doc.length) return fail("Choose a document from this application.");
      documentId = doc[0].id as string;
      if (subject === "legal_clearance" && evidence === "verified" && doc[0].kind !== "legal_opinion") {
        return fail("Legal clearance can only be verified against a legal opinion / regulatory clearance document.");
      }
    }
    if (evidence === "verified" && !documentId) return fail("A verified finding must cite the document it was verified against.");
  }
  const rows = await db()`insert into rwa_findings (application_id, author_user_id, kind, subject, evidence_status, document_id, body)
    values (${app.id as string}, ${session.user.id}, ${kind}, ${subject}, ${evidence}, ${documentId}, ${text}) returning id, created_at`;
  await audit({ actor: { id: session.user.id, email: session.user.email }, action: kind === "note" ? "rwa.note.added" : "rwa.finding.recorded", targetType: "rwa_application", targetId: ref,
    details: kind === "finding" ? { subject, evidenceStatus: evidence, documentId } : {} });
  return json({ id: rows[0].id }, 201);
});
