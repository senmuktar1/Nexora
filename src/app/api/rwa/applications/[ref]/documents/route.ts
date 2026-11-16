import { db } from "@/lib/server/db";
import { fail, json, route } from "@/lib/server/http";
import { rateLimited } from "@/lib/server/rate-limit";
import { requireUser } from "@/lib/server/auth/guard";
import { isEditable, ownedApplication, readUpload, storeDocument } from "@/lib/server/rwa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/** Uploads a supporting document (PDF/PNG/JPEG ≤ 4 MB), encrypted before storage. */
export const POST = route<{ ref: string }>("rwa:upload", async (request, { ref }) => {
  const session = await requireUser(request, { mutate: true });
  if (rateLimited(request, "rwa-upload", 30, 10 * 60_000)) return fail("Too many uploads. Try again shortly.", 429);
  const app = await ownedApplication(ref, session.user.id);
  const { kind, file } = await readUpload(request);
  // After approval, only the legal opinion / regulatory clearance can be added (needed for authorization).
  const legalAfterApproval = app.status === "approved" && kind === "legal_opinion"
    && !(await db()`select 1 from rwa_token_configs where application_id = ${app.id as string} and status in ('authorized','issued')`).length;
  if (!isEditable(app.status) && !legalAfterApproval) return fail("Documents can't be added in the current status.", 409);
  const doc = await storeDocument(app, kind, file, { id: session.user.id, email: session.user.email });
  return json({ document: doc }, 201);
});
