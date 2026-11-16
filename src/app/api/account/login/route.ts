import type { NextRequest } from "next/server";
import { fail, isAdminHost, json, readJson, sameOrigin, serverFailure } from "@/lib/server/http";
import { clientKey, rateLimited } from "@/lib/server/rate-limit";
import { login } from "@/lib/server/auth/accounts";
import { createSession } from "@/lib/server/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (isAdminHost(request.headers.get("host"))) return fail("Not found.", 404);
    if (!sameOrigin(request)) return fail("Request blocked.", 403);
    if (rateLimited(request, "account-login", 10)) return fail("Too many attempts. Try again later.", 429);
    const body = await readJson<{ email?: unknown; password?: unknown }>(request);
    const outcome = await login("public", body.email, body.password, clientKey(request));
    if (!outcome.ok) {
      if (outcome.reason === "locked") return fail("Too many failed attempts. Try again in 15 minutes.", 429);
      if (outcome.reason === "unverified") return fail("Confirm your email using the link we sent first.", 403);
      return fail("Email or password is incorrect.", 401);
    }
    const response = json({ ok: true });
    await createSession(response, outcome.user, "public", false, request.headers.get("user-agent"));
    return response;
  } catch (e) {
    return serverFailure(e, "account:login");
  }
}
