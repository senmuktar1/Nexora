import { fail, json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { getSettings } from "@/lib/server/settings";
import { ownedApplication, submissionProblems, transition } from "@/lib/server/rwa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Submits (or re-submits after an information request) for review. */
export const POST = route<{ ref: string }>("rwa:submit", async (request, { ref }) => {
  const session = await requireUser(request, { mutate: true });
  const app = await ownedApplication(ref, session.user.id);
  if (app.status !== "draft" && app.status !== "info_requested") return fail("This application has already been submitted.", 409);
  if (app.status === "draft" && !(await getSettings()).applicationsOpen) return fail("New applications are paused at the moment.", 403);
  const problems = await submissionProblems(app);
  if (problems.length) return json({ error: "Complete the application before submitting.", problems }, 400);
  await transition(app, "submitted", { id: session.user.id, email: session.user.email }, app.status === "info_requested" ? "Information provided" : null, { admin: false, action: "submit" });
  return json({ ok: true, status: "submitted" });
});
