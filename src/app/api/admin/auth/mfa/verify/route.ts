import type { NextRequest } from "next/server";
import { fail, json, readJson, serverFailure } from "@/lib/server/http";
import { rateLimited } from "@/lib/server/rate-limit";
import { adminSessionPartial, assertSameOrigin } from "@/lib/server/auth/guard";
import { verifyMfa } from "@/lib/server/auth/accounts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const session = await adminSessionPartial(request);
    assertSameOrigin(request);
    if (rateLimited(request, "admin-mfa", 10)) return fail("Too many attempts. Try again later.", 429);
    const body = await readJson<{ code?: unknown; recoveryCode?: unknown }>(request);
    if (!(await verifyMfa(session, body.code, body.recoveryCode))) return fail("That code didn't work.", 400);
    return json({ ok: true });
  } catch (e) {
    return serverFailure(e, "admin:mfa-verify");
  }
}
