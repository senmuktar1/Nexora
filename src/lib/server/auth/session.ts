import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { randomToken, sha256Hex } from "@/lib/server/crypto";

export type Realm = "public" | "admin";
export type Role = "user" | "super_admin" | "reviewer" | "compliance";

export type AuthUser = {
  id: string; realm: Realm; email: string; role: Role; status: "pending" | "active" | "suspended";
  email_verified_at: Date | null; mfa_enabled: boolean; stellar_address: string | null;
};
export type AuthSession = { tokenHash: string; kind: Realm; mfaPassed: boolean; user: AuthUser };

/** `__Host-` cookies are host-only, Secure and Path=/: the admin cookie is never sent to the public site and vice versa. */
export const COOKIE = { admin: "__Host-nx_admin", public: "__Host-nx_user" } as const;

const POLICY = {
  admin: { idleMs: 30 * 60_000, absoluteMs: 8 * 3_600_000 },
  public: { idleMs: 7 * 86_400_000, absoluteMs: 30 * 86_400_000 }
} as const;

export async function createSession(response: NextResponse, user: { id: string }, kind: Realm, mfaPassed: boolean, userAgent: string | null) {
  const token = randomToken(32);
  const p = POLICY[kind];
  const now = Date.now();
  await db()`insert into sessions (token_hash, user_id, kind, mfa_passed, expires_at, idle_expires_at, user_agent)
    values (${sha256Hex(token)}, ${user.id}, ${kind}, ${mfaPassed}, ${new Date(now + p.absoluteMs)}, ${new Date(now + p.idleMs)}, ${(userAgent ?? "").slice(0, 200)})`;
  response.cookies.set(COOKIE[kind], token, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: Math.floor(p.absoluteMs / 1000) });
}

export function clearSessionCookie(response: NextResponse, kind: Realm) {
  response.cookies.set(COOKIE[kind], "", { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 0 });
}

export async function getSession(request: NextRequest, kind: Realm): Promise<AuthSession | null> {
  const token = request.cookies.get(COOKIE[kind])?.value;
  if (!token || token.length > 100) return null;
  const tokenHash = sha256Hex(token);
  const rows = await db()`
    update sessions s set idle_expires_at = least(s.expires_at, now() + ${POLICY[kind].idleMs / 1000} * interval '1 second')
    from app_users u
    where s.token_hash = ${tokenHash} and s.kind = ${kind} and s.user_id = u.id
      and s.expires_at > now() and s.idle_expires_at > now() and u.realm = ${kind}
    returning s.mfa_passed, u.id, u.realm, u.email, u.role, u.status, u.email_verified_at, u.mfa_enabled, u.stellar_address`;
  const r = rows[0];
  if (!r) return null;
  const user: AuthUser = {
    id: r.id as string, realm: r.realm as Realm, email: r.email as string, role: r.role as Role, status: r.status as AuthUser["status"],
    email_verified_at: r.email_verified_at as Date | null, mfa_enabled: r.mfa_enabled as boolean, stellar_address: r.stellar_address as string | null
  };
  if (user.status === "suspended") return null;
  return { tokenHash, kind, mfaPassed: r.mfa_passed as boolean, user };
}

export async function markMfaPassed(tokenHash: string) {
  await db()`update sessions set mfa_passed = true where token_hash = ${tokenHash}`;
}

export async function destroySession(tokenHash: string) {
  await db()`delete from sessions where token_hash = ${tokenHash}`;
}

export async function destroyUserSessions(userId: string) {
  await db()`delete from sessions where user_id = ${userId}`;
}
