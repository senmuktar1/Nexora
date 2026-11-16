import { db } from "@/lib/server/db";
import { fail, json, readJson, route } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/auth/guard";
import { audit } from "@/lib/server/audit";
import { adminApplication, loadDocument } from "@/lib/server/rwa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Marks a document as published with the offering (visible to investors) or private. */
export const PATCH = route<{ ref: string; id: string }>("admin:doc-visibility", async (request, { ref, id }) => {
  const session = await requireAdmin(request, "assets.manage", { mutate: true });
  const app = await adminApplication(ref);
  const doc = await loadDocument(id);
  if (!doc || doc.application_id !== app.id) return fail("Document not found.", 404);
  const body = await readJson(request);
  if (typeof body.public !== "boolean") return fail("Invalid request.");
  await db()`update rwa_documents set public_with_offering = ${body.public} where id = ${id}`;
  await audit({ actor: { id: session.user.id, email: session.user.email }, action: body.public ? "rwa.document.published" : "rwa.document.unpublished", targetType: "rwa_application", targetId: ref, details: { documentId: id, filename: doc.filename } });
  return json({ ok: true });
});
