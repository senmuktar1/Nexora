import type { NextRequest } from "next/server";
import { fail, isAdminHost, json, readJson, sameOrigin, serverFailure } from "@/lib/server/http";
import { rateLimited } from "@/lib/server/rate-limit";
import { verifyEmail } from "@/lib/server/auth/accounts";
import { createSession } from "@/lib/server/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (isAdminHost(request.headers.get("host"))) return fail("Not found.", 404);
    if (!sameOrigin(request)) return fail("Request blocked.", 403);
    if (rateLimited(request, "account-verify", 10, 15 * 60_000)) return fail("Too many attempts. Try again later.", 429);
    const body = await readJson<{ token?: unknown; password?: unknown }>(request);
    const user = await verifyEmail("public", body.token, body.password);
    if (!user) return fail("This link is invalid or expired, or the password doesn't match.");
    const response = json({ ok: true });
    await createSession(response, user, "public", false, request.headers.get("user-agent"));
    return response;
  } catch (e) {
    return serverFailure(e, "account:verify");
  }
}
