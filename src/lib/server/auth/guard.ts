import "server-only";
import type { NextRequest } from "next/server";
import { HttpError, isAdminHost, sameOrigin } from "@/lib/server/http";
import { getSession, type AuthSession, type Role } from "@/lib/server/auth/session";
import { configuredAdminEmail } from "@/lib/server/auth/accounts";
import { safeEqual } from "@/lib/server/crypto";

/**
 * Server-side permission model. Roles are assigned only on the server (never chosen
 * by a user). Staff roles exist for future use; only the Super Admin can be created
 * today (one-time bootstrap).
 */
export const PERMISSIONS = [
  "applications.read", "applications.review", "applications.decide", "documents.read", "findings.write",
  "tokenization.authorize", "assets.manage", "lifecycle.manage", "users.read", "users.manage", "audit.read", "settings.manage"
] as const;
export type Permission = typeof PERMISSIONS[number];

const ROLE_PERMISSIONS: Record<Exclude<Role, "user">, readonly Permission[]> = {
  super_admin: PERMISSIONS,
  reviewer: ["applications.read", "applications.review", "documents.read", "findings.write"],
  compliance: ["applications.read", "documents.read", "audit.read", "users.read", "lifecycle.manage"]
};

export function can(role: Role, permission: Permission): boolean {
  return role !== "user" && ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsOf(role: Role): Permission[] {
  return role === "user" ? [] : [...ROLE_PERMISSIONS[role]];
}

/** Rejects requests that aren't on the admin host (404, as if the route didn't exist). */
export function assertAdminHost(request: NextRequest) {
  if (!isAdminHost(request.headers.get("host"))) throw new HttpError(404, "Not found.");
}

export function assertSameOrigin(request: NextRequest) {
  if (!sameOrigin(request)) throw new HttpError(403, "Request blocked.");
}

/** A signed-in admin session (password checked) — MFA may still be pending. */
export async function adminSessionPartial(request: NextRequest): Promise<AuthSession> {
  assertAdminHost(request);
  const session = await getSession(request, "admin");
  if (!session || session.user.status !== "active") throw new HttpError(401, "Sign in required.");
  if (session.user.role === "super_admin") {
    const configured = configuredAdminEmail();
    if (!configured || !safeEqual(configured, session.user.email)) throw new HttpError(401, "Sign in required.");
  }
  return session;
}

/** Full admin access: admin host + session + MFA passed + role permission. */
export async function requireAdmin(request: NextRequest, permission: Permission, opts: { mutate?: boolean } = {}): Promise<AuthSession> {
  if (opts.mutate) { assertAdminHost(request); assertSameOrigin(request); }
  const session = await adminSessionPartial(request);
  if (!session.user.mfa_enabled || !session.mfaPassed) throw new HttpError(401, "Two-factor verification required.");
  if (!can(session.user.role, permission)) throw new HttpError(403, "You don't have permission to do this.");
  return session;
}

/** Signed-in public user (applicant/investor). Admin host never serves public account routes. */
export async function requireUser(request: NextRequest, opts: { mutate?: boolean; verified?: boolean } = {}): Promise<AuthSession> {
  if (isAdminHost(request.headers.get("host"))) throw new HttpError(404, "Not found.");
  if (opts.mutate) assertSameOrigin(request);
  const session = await getSession(request, "public");
  if (!session) throw new HttpError(401, "Sign in to continue.");
  if ((opts.verified ?? true) && (!session.user.email_verified_at || session.user.status !== "active")) throw new HttpError(403, "Confirm your email first.");
  return session;
}
