import type { NextRequest } from "next/server";
import { fail, json, sameOrigin, serverFailure } from "@/lib/server/http";
import { clearSessionCookie, destroySession, getSession } from "@/lib/server/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) return fail("Request blocked.", 403);
    const session = await getSession(request, "public");
    if (session) await destroySession(session.tokenHash);
    const response = json({ ok: true });
    clearSessionCookie(response, "public");
    return response;
  } catch (e) {
    return serverFailure(e, "account:logout");
  }
}
