import { db } from "@/lib/server/db";
import { fail, json, readJson, route } from "@/lib/server/http";
import { rateLimited } from "@/lib/server/rate-limit";
import { requireUser } from "@/lib/server/auth/guard";
import { getSettings } from "@/lib/server/settings";
import { newReference, parseApplicationUpdate } from "@/lib/server/rwa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The signed-in user's applications. */
export const GET = route("rwa:list", async request => {
  const session = await requireUser(request, { verified: false });
  const rows = await db()`select reference, status, category, asset_name, created_at, updated_at, submitted_at from rwa_applications
    where owner_user_id = ${session.user.id} order by created_at desc`;
  return json({ applications: rows });
});

/** Starts a draft application with a unique reference. */
export const POST = route("rwa:create", async request => {
  const session = await requireUser(request, { mutate: true });
  if (rateLimited(request, "rwa-create", 10, 3_600_000)) return fail("Too many new applications. Try again later.", 429);
  if (!(await getSettings()).applicationsOpen) return fail("New applications are paused at the moment.", 403);
  const body = await readJson(request);
  const fields = parseApplicationUpdate({ category: body.category, asset_name: body.asset_name });
  if (!fields.category || !fields.asset_name) return fail("Choose a category and enter the asset name.");
  const open = await db()`select count(*)::int as n from rwa_applications where owner_user_id = ${session.user.id} and status = 'draft'`;
  if ((open[0].n as number) >= 10) return fail("Finish or delete some draft applications first.", 400);
  for (let attempt = 0; attempt < 5; attempt++) {
    const reference = newReference();
    const rows = await db()`insert into rwa_applications (reference, owner_user_id, category, asset_name, issuer_stellar_address)
      values (${reference}, ${session.user.id}, ${fields.category as string}, ${fields.asset_name as string}, ${session.user.stellar_address})
      on conflict (reference) do nothing returning id`;
    if (rows.length) {
      await db()`insert into rwa_status_history (application_id, actor_user_id, from_status, to_status) values (${rows[0].id as string}, ${session.user.id}, null, 'draft')`;
      return json({ reference }, 201);
    }
  }
  throw new Error("could not allocate reference");
});
