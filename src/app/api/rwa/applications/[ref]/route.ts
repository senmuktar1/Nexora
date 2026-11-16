import { db } from "@/lib/server/db";
import { fail, json, readJson, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { isEditable, ownedApplication, parseApplicationUpdate } from "@/lib/server/rwa";
import { ownerView } from "@/lib/server/rwa-views";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type P = { ref: string };

export const GET = route<P>("rwa:get", async (request, { ref }) => {
  const session = await requireUser(request, { verified: false });
  return json(await ownerView(await ownedApplication(ref, session.user.id)));
});

/** Saves fields while the application is a draft or more information was requested. */
export const PATCH = route<P>("rwa:update", async (request, { ref }) => {
  const session = await requireUser(request, { mutate: true });
  const app = await ownedApplication(ref, session.user.id);
  if (!isEditable(app.status)) return fail("This application can't be edited in its current status.", 409);
  const fields = parseApplicationUpdate(await readJson(request));
  const keys = Object.keys(fields);
  if (!keys.length) return json({ ok: true });
  const updated = await db()`update rwa_applications set ${db()(fields, ...keys)}, updated_at = now()
    where id = ${app.id as string} and status in ('draft','info_requested') returning reference`;
  if (!updated.length) return fail("This application can't be edited in its current status.", 409);
  return json({ ok: true });
});

/** Deletes a draft that was never submitted. */
export const DELETE = route<P>("rwa:delete", async (request, { ref }) => {
  const session = await requireUser(request, { mutate: true });
  const app = await ownedApplication(ref, session.user.id);
  const rows = await db()`delete from rwa_applications where id = ${app.id as string} and status = 'draft' and submitted_at is null returning id`;
  if (!rows.length) return fail("Only unsubmitted drafts can be deleted.", 409);
  return json({ ok: true });
});
