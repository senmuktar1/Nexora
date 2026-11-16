import type { NextRequest } from "next/server";
import { fail, json, originOf, readJson, serverFailure } from "@/lib/server/http";
import { rateLimited } from "@/lib/server/rate-limit";
import { passwordProblem } from "@/lib/server/crypto";
import { assertAdminHost, assertSameOrigin } from "@/lib/server/auth/guard";
import { startAdminBootstrap } from "@/lib/server/auth/accounts";
import { EmailUnavailable } from "@/lib/server/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertAdminHost(request);
    assertSameOrigin(request);
    if (rateLimited(request, "admin-bootstrap", 5, 15 * 60_000)) return fail("Too many attempts. Try again later.", 429);
    const body = await readJson<{ email?: unknown; password?: unknown }>(request);
    const problem = passwordProblem(body.password);
    if (problem) return fail(problem);
    const result = await startAdminBootstrap(body.email, body.password as string, originOf(request));
    if (result === "email_sent") return json({ ok: true });
    if (result === "email_not_authorized") return fail("This email can't be used to set up administration.", 403);
    if (result === "in_progress") return fail("Administrator setup was already confirmed. Sign in to finish it.", 409);
    return fail("Administrator setup isn't available.", 403);
  } catch (e) {
    if (e instanceof EmailUnavailable) return fail("Email delivery isn't configured on the server.", 503);
    return serverFailure(e, "admin:bootstrap");
  }
}
