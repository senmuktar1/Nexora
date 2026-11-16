import type { NextRequest } from "next/server";
import { json, serverFailure } from "@/lib/server/http";
import { assertAdminHost, assertSameOrigin } from "@/lib/server/auth/guard";
import { clearSessionCookie, destroySession, getSession } from "@/lib/server/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertAdminHost(request);
    assertSameOrigin(request);
    const session = await getSession(request, "admin");
    if (session) await destroySession(session.tokenHash);
    const response = json({ ok: true });
    clearSessionCookie(response, "admin");
    return response;
  } catch (e) {
    return serverFailure(e, "admin:logout");
  }
}
