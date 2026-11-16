import type { NextRequest } from "next/server";
import { fail, isAdminHost, json, normaliseEmail, originOf, readJson, sameOrigin, serverFailure } from "@/lib/server/http";
import { rateLimited } from "@/lib/server/rate-limit";
import { passwordProblem } from "@/lib/server/crypto";
import { registerPublic } from "@/lib/server/auth/accounts";
import { EmailUnavailable } from "@/lib/server/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Public sign-up for applicants and investors. Creates a plain user account only (no roles). */
export async function POST(request: NextRequest) {
  try {
    if (isAdminHost(request.headers.get("host"))) return fail("Not found.", 404);
    if (!sameOrigin(request)) return fail("Request blocked.", 403);
    if (rateLimited(request, "account-register", 5, 15 * 60_000)) return fail("Too many attempts. Try again later.", 429);
    const body = await readJson<{ email?: unknown; password?: unknown }>(request);
    if (!normaliseEmail(body.email)) return fail("Enter a valid email address.");
    const problem = passwordProblem(body.password);
    if (problem) return fail(problem);
    await registerPublic(body.email, body.password as string, originOf(request));
    return json({ ok: true });
  } catch (e) {
    if (e instanceof EmailUnavailable) return fail("Email delivery isn't configured yet. Try again later.", 503);
    return serverFailure(e, "account:register");
  }
}
