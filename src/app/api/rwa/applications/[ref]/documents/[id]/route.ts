import { db } from "@/lib/server/db";
import { fail, json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { isEditable, loadDocument, ownedApplication } from "@/lib/server/rwa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Removes a document while the application is still editable. */
export const DELETE = route<{ ref: string; id: string }>("rwa:doc-delete", async (request, { ref, id }) => {
  const session = await requireUser(request, { mutate: true });
  const app = await ownedApplication(ref, session.user.id);
  if (!isEditable(app.status)) return fail("Documents can't be removed in the current status.", 409);
  const doc = await loadDocument(id);
  if (!doc || doc.application_id !== app.id) return fail("Document not found.", 404);
  const referenced = await db()`select 1 from rwa_findings where document_id = ${id} union all select 1 from rwa_asset_events where document_id = ${id} limit 1`;
  if (referenced.length) return fail("This document is referenced in the review record and can't be removed.", 409);
  await db()`delete from rwa_documents where id = ${id}`;
  return json({ ok: true });
});
