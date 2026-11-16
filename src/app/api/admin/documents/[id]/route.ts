import { fail, route } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/auth/guard";
import { audit } from "@/lib/server/audit";
import { documentResponse, loadDocument } from "@/lib/server/rwa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Reviewer download (logged). */
export const GET = route<{ id: string }>("admin:doc-get", async (request, { id }) => {
  const session = await requireAdmin(request, "documents.read");
  const doc = await loadDocument(id);
  if (!doc || doc.app_status === "draft") return fail("Document not found.", 404);
  await audit({ actor: { id: session.user.id, email: session.user.email }, action: "rwa.document.viewed", targetType: "rwa_application", targetId: doc.reference as string, details: { documentId: id, filename: doc.filename } });
  return documentResponse(doc);
});
