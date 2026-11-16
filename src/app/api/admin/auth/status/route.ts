import type { NextRequest } from "next/server";
import { dbConfigured } from "@/lib/server/db";
import { encryptionConfigured } from "@/lib/server/crypto";
import { emailMode } from "@/lib/server/email";
import { json, serverFailure } from "@/lib/server/http";
import { assertAdminHost, permissionsOf } from "@/lib/server/auth/guard";
import { bootstrapCompleted, configuredAdminEmail } from "@/lib/server/auth/accounts";
import { getSession } from "@/lib/server/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Admin portal state. Never reveals the configured admin email. */
export async function GET(request: NextRequest) {
  try {
    assertAdminHost(request);
    const ready = {
      database: dbConfigured(),
      encryption: encryptionConfigured(),
      email: emailMode() !== "none",
      adminEmail: !!configuredAdminEmail()
    };
    if (!ready.database) return json({ ready, bootstrapAvailable: false, session: null });
    const completed = await bootstrapCompleted();
    const session = await getSession(request, "admin");
    return json({
      ready,
      bootstrapAvailable: !completed && Object.values(ready).every(Boolean),
      session: session ? {
        email: session.user.email,
        role: session.user.role,
        mfaEnabled: session.user.mfa_enabled,
        mfaPassed: session.mfaPassed,
        permissions: session.user.mfa_enabled && session.mfaPassed ? permissionsOf(session.user.role) : []
      } : null
    });
  } catch (e) {
    return serverFailure(e, "admin:status");
  }
}
