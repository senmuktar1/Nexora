import type { NextRequest } from "next/server";
import { StrKey } from "@stellar/stellar-sdk";
import { dbConfigured } from "@/lib/server/db";
import { fail, HttpError, isAdminHost, json, readJson, serverFailure } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth/guard";
import { getSession } from "@/lib/server/auth/session";
import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    if (isAdminHost(request.headers.get("host"))) return fail("Not found.", 404);
    if (!dbConfigured()) return json({ available: false, user: null });
    const session = await getSession(request, "public");
    return json({ available: true, user: session ? { email: session.user.email, verified: !!session.user.email_verified_at, stellarAddress: session.user.stellar_address } : null });
  } catch (e) {
    return serverFailure(e, "account:me");
  }
}

/** Links the user's public Stellar address (never a key) to the account. */
export async function PATCH(request: NextRequest) {
  try {
    const session = await requireUser(request, { mutate: true });
    const body = await readJson<{ stellarAddress?: unknown }>(request);
    const address = body.stellarAddress === null ? null : typeof body.stellarAddress === "string" ? body.stellarAddress.trim() : undefined;
    if (address === undefined || (address !== null && !StrKey.isValidEd25519PublicKey(address))) throw new HttpError(400, "Enter a valid Stellar public address (G…).");
    await db()`update app_users set stellar_address = ${address}, updated_at = now() where id = ${session.user.id}`;
    return json({ ok: true });
  } catch (e) {
    return serverFailure(e, "account:me-update");
  }
}
