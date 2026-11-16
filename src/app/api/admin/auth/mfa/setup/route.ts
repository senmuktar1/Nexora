import type { NextRequest } from "next/server";
import QRCode from "qrcode";
import { fail, json, serverFailure } from "@/lib/server/http";
import { adminSessionPartial, assertSameOrigin } from "@/lib/server/auth/guard";
import { beginMfaSetup } from "@/lib/server/auth/accounts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Generates a new authenticator secret (stored encrypted) for an account without MFA. */
export async function POST(request: NextRequest) {
  try {
    const session = await adminSessionPartial(request);
    assertSameOrigin(request);
    const setup = await beginMfaSetup(session);
    if (!setup) return fail("Two-factor authentication is already set up.", 409);
    const qr = await QRCode.toDataURL(setup.uri, { margin: 1, width: 220 });
    return json({ secret: setup.secret, uri: setup.uri, qr });
  } catch (e) {
    return serverFailure(e, "admin:mfa-setup");
  }
}
