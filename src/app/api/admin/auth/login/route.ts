import type { NextRequest } from "next/server";
import { fail, json, readJson, serverFailure } from "@/lib/server/http";
import { clientKey, rateLimited } from "@/lib/server/rate-limit";
import { assertAdminHost, assertSameOrigin } from "@/lib/server/auth/guard";
import { login } from "@/lib/server/auth/accounts";
import { createSession } from "@/lib/server/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertAdminHost(request);
    assertSameOrigin(request);
    if (rateLimited(request, "admin-login", 10)) return fail("Too many attempts. Try again later.", 429);
    const body = await readJson<{ email?: unknown; password?: unknown }>(request);
    const outcome = await login("admin", body.email, body.password, clientKey(request));
    if (!outcome.ok) {
      if (outcome.reason === "locked") return fail("Too many failed attempts. Try again in 15 minutes.", 429);
      if (outcome.reason === "unverified") return fail("Confirm your email using the link we sent first.", 403);
      return fail("Email or password is incorrect.", 401);
    }
    const response = json({ ok: true, next: outcome.user.mfaEnabled ? "mfa" : "mfa_setup" });
    await createSession(response, outcome.user, "admin", false, request.headers.get("user-agent"));
    return response;
  } catch (e) {
    return serverFailure(e, "admin:login");
  }
}
