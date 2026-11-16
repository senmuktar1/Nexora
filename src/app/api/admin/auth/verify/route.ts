import type { NextRequest } from "next/server";
import { fail, json, readJson, serverFailure } from "@/lib/server/http";
import { rateLimited } from "@/lib/server/rate-limit";
import { assertAdminHost, assertSameOrigin } from "@/lib/server/auth/guard";
import { verifyEmail } from "@/lib/server/auth/accounts";
import { createSession } from "@/lib/server/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Email link + the password chosen at setup. Then the authenticator must be enrolled. */
export async function POST(request: NextRequest) {
  try {
    assertAdminHost(request);
    assertSameOrigin(request);
    if (rateLimited(request, "admin-verify", 10, 15 * 60_000)) return fail("Too many attempts. Try again later.", 429);
    const body = await readJson<{ token?: unknown; password?: unknown }>(request);
    const user = await verifyEmail("admin", body.token, body.password);
    if (!user) return fail("This link is invalid or expired, or the password doesn't match.", 400);
    const response = json({ ok: true, next: "mfa_setup" });
    await createSession(response, user, "admin", false, request.headers.get("user-agent"));
    return response;
  } catch (e) {
    return serverFailure(e, "admin:verify");
  }
}
