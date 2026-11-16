import { db } from "@/lib/server/db";
import { fail, isAdminHost, route } from "@/lib/server/http";
import { getSession } from "@/lib/server/auth/session";
import { documentResponse, loadDocument } from "@/lib/server/rwa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Document download on the public site: the owner of the application, or anyone for a
 * document the reviewers marked public on a published, issued offering.
 */
export const GET = route<{ id: string }>("rwa:doc-get", async (request, { id }) => {
  if (isAdminHost(request.headers.get("host"))) return fail("Not found.", 404);
  const doc = await loadDocument(id);
  if (!doc) return fail("Document not found.", 404);
  const session = await getSession(request, "public");
  if (session && session.user.id === doc.owner_user_id) return documentResponse(doc);
  if (doc.public_with_offering && doc.published && doc.app_status === "approved") {
    const cfg = await db()`select status from rwa_token_configs where application_id = ${doc.application_id as string}`;
    if (cfg[0]?.status === "issued") return documentResponse(doc);
  }
  return fail("Document not found.", 404);
});
