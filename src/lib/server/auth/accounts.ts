import "server-only";
import { db } from "@/lib/server/db";
import { dummyHash, hashPassword, randomToken, safeEqual, sha256Hex, verifyPassword, encryptString, decryptString } from "@/lib/server/crypto";
import { normaliseEmail } from "@/lib/server/http";
import { sendEmail } from "@/lib/server/email";
import { audit } from "@/lib/server/audit";
import { clearFailures, isLocked, recordFailure } from "@/lib/server/auth/lockout";
import { newTotpSecret, otpauthUri, verifyTotp } from "@/lib/server/auth/totp";
import type { AuthSession, Realm } from "@/lib/server/auth/session";

const VERIFY_TTL_MS = 24 * 3_600_000;

/** The founder's email, read only on the server from NEXORA_ADMIN_EMAIL. */
export function configuredAdminEmail(env: NodeJS.ProcessEnv = process.env): string | null {
  return normaliseEmail(env.NEXORA_ADMIN_EMAIL);
}

export async function bootstrapCompleted(): Promise<boolean> {
  return (await db()`select 1 from admin_bootstrap`).length > 0;
}

async function issueVerification(userId: string, email: string, link: (token: string) => string, subject: string, intro: string) {
  const token = randomToken(32);
  await db()`delete from email_tokens where user_id = ${userId} and purpose = 'verify'`;
  await db()`insert into email_tokens (token_hash, user_id, purpose, expires_at) values (${sha256Hex(token)}, ${userId}, 'verify', ${new Date(Date.now() + VERIFY_TTL_MS)})`;
  await sendEmail({
    to: email,
    subject,
    text: `${intro}\n\nOpen this link within 24 hours and enter your password to confirm:\n${link(token)}\n\nIf you didn't request this, ignore this email.`
  });
}

/* ───────────────────────── Admin bootstrap (one-time) ───────────────────────── */

export type BootstrapResult = "email_sent" | "not_available" | "email_not_authorized" | "in_progress";

/**
 * Starts the one-time Super Admin setup. Only the email in NEXORA_ADMIN_EMAIL is accepted;
 * the account becomes usable only after the link sent to that mailbox is opened AND the
 * same password is entered, then an authenticator app is enrolled.
 */
export async function startAdminBootstrap(emailInput: unknown, password: string, origin: string): Promise<BootstrapResult> {
  const configured = configuredAdminEmail();
  if (!configured || await bootstrapCompleted()) return "not_available";
  const email = normaliseEmail(emailInput);
  if (!email || !safeEqual(email, configured)) {
    await audit({ action: "admin.bootstrap.rejected", reason: "email_not_authorized", details: { attemptedEmail: (email ?? "").slice(0, 120) } });
    return "email_not_authorized";
  }
  const existing = await db()`select id, email, email_verified_at from app_users where role = 'super_admin'`;
  if (existing[0] && (existing[0].email !== email || existing[0].email_verified_at)) return "in_progress";
  const hash = await hashPassword(password);
  let userId: string;
  if (existing[0]) {
    userId = existing[0].id as string;
    await db()`update app_users set password_hash = ${hash}, updated_at = now() where id = ${userId}`;
  } else {
    const rows = await db()`insert into app_users (realm, email, password_hash, role, status) values ('admin', ${email}, ${hash}, 'super_admin', 'pending') returning id`;
    userId = rows[0].id as string;
  }
  await issueVerification(userId, email, t => `${origin}/admin/verify?token=${t}`, "Confirm NEXORA administrator setup",
    "Someone started the one-time NEXORA administrator setup with this email address.");
  await audit({ actor: { id: userId, email }, action: "admin.bootstrap.started", targetType: "user", targetId: userId });
  return "email_sent";
}

/* ───────────────────────── Public registration ───────────────────────── */

/** Always reports success to the caller (no account enumeration). */
export async function registerPublic(emailInput: unknown, password: string, origin: string): Promise<boolean> {
  const email = normaliseEmail(emailInput);
  if (!email) return false;
  const rows = await db()`select id, email_verified_at from app_users where realm = 'public' and email = ${email}`;
  if (rows[0]?.email_verified_at) {
    await sendEmail({ to: email, subject: "NEXORA account", text: "Someone tried to create a NEXORA account with this email, which already has one. If it was you, sign in instead. Otherwise you can ignore this email." });
    return true;
  }
  const hash = await hashPassword(password);
  let userId: string;
  if (rows[0]) {
    userId = rows[0].id as string;
    await db()`update app_users set password_hash = ${hash}, updated_at = now() where id = ${userId}`;
  } else {
    userId = (await db()`insert into app_users (realm, email, password_hash, role, status) values ('public', ${email}, ${hash}, 'user', 'pending') returning id`)[0].id as string;
  }
  await issueVerification(userId, email, t => `${origin}/account/verify?token=${t}`, "Confirm your NEXORA account", "Welcome to NEXORA.");
  return true;
}

/* ───────────────────────── Email verification ───────────────────────── */

export async function verifyEmail(realm: Realm, token: unknown, password: unknown): Promise<{ id: string; email: string } | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 100 || typeof password !== "string") return null;
  const rows = await db()`
    select t.token_hash, u.id, u.email, u.password_hash, u.role from email_tokens t join app_users u on u.id = t.user_id
    where t.token_hash = ${sha256Hex(token)} and t.purpose = 'verify' and t.used_at is null and t.expires_at > now() and u.realm = ${realm}`;
  const r = rows[0];
  if (!r || !(await verifyPassword(password, r.password_hash as string))) return null;
  if (realm === "admin" && r.role === "super_admin") {
    const configured = configuredAdminEmail();
    if (!configured || !safeEqual(configured, r.email as string) || await bootstrapCompleted()) return null;
  }
  await db().begin(async tx => {
    await tx`update email_tokens set used_at = now() where token_hash = ${r.token_hash as string}`;
    await tx`update app_users set email_verified_at = now(), status = 'active', updated_at = now() where id = ${r.id as string} and status = 'pending'`;
  });
  if (realm === "admin") await audit({ actor: { id: r.id as string, email: r.email as string }, action: "admin.email_verified", targetType: "user", targetId: r.id as string });
  return { id: r.id as string, email: r.email as string };
}

/* ───────────────────────── Sign-in ───────────────────────── */

export type LoginOutcome =
  | { ok: true; user: { id: string; email: string; mfaEnabled: boolean } }
  | { ok: false; reason: "invalid" | "locked" | "unverified" };

export async function login(realm: Realm, emailInput: unknown, password: unknown, ip: string): Promise<LoginOutcome> {
  const email = normaliseEmail(emailInput);
  const ipKey = `${realm}-ip:${ip}`;
  const emailKey = `${realm}:${email ?? "invalid"}`;
  if (await isLocked([ipKey, emailKey])) return { ok: false, reason: "locked" };
  const rows = email ? await db()`select id, email, password_hash, role, status, email_verified_at, mfa_enabled from app_users where realm = ${realm} and email = ${email}` : [];
  const u = rows[0];
  const passwordOk = typeof password === "string" && password.length <= 200
    && await verifyPassword(password, (u?.password_hash as string) ?? await dummyHash());

  // The Super Admin can only sign in with the email currently configured on the server.
  let authorised = !!u && passwordOk && u.status !== "suspended";
  if (authorised && realm === "admin" && u!.role === "super_admin") {
    const configured = configuredAdminEmail();
    if (!configured || !safeEqual(configured, u!.email as string)) authorised = false;
  }
  if (!authorised) {
    await recordFailure(emailKey, 5);
    await recordFailure(ipKey, 30);
    if (realm === "admin") await audit({ action: "admin.login.rejected", reason: u ? (passwordOk ? "not_authorized" : "bad_password") : "unknown_email", details: { attemptedEmail: (email ?? "").slice(0, 120) } });
    return { ok: false, reason: "invalid" };
  }
  if (!u!.email_verified_at) return { ok: false, reason: "unverified" };
  await clearFailures(emailKey);
  await db()`update app_users set last_login_at = now() where id = ${u!.id as string}`;
  return { ok: true, user: { id: u!.id as string, email: u!.email as string, mfaEnabled: u!.mfa_enabled as boolean } };
}

/* ───────────────────────── MFA (admin) ───────────────────────── */

export async function beginMfaSetup(session: AuthSession): Promise<{ secret: string; uri: string } | null> {
  if (session.user.mfa_enabled) return null;
  const secret = newTotpSecret();
  await db()`update app_users set mfa_secret_enc = ${encryptString("mfa", secret, session.user.id)} where id = ${session.user.id} and mfa_enabled = false`;
  return { secret, uri: otpauthUri(secret, session.user.email) };
}

function recoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => randomToken(8).replace(/[^A-Za-z0-9]/g, "").slice(0, 10).toUpperCase().replace(/(.{5})/, "$1-"));
}

/** Confirms the first code, enables MFA and, for the founder, completes the one-time bootstrap. */
export async function enableMfa(session: AuthSession, code: unknown): Promise<string[] | null> {
  const rows = await db()`select mfa_secret_enc, mfa_enabled, role, email from app_users where id = ${session.user.id}`;
  const r = rows[0];
  if (!r || r.mfa_enabled || !r.mfa_secret_enc || typeof code !== "string") return null;
  const step = verifyTotp(decryptString("mfa", r.mfa_secret_enc as string, session.user.id), code.trim());
  if (step === null) return null;
  const codes = recoveryCodes();
  const hashed = codes.map(c => sha256Hex(c));
  const isFounder = r.role === "super_admin";
  try {
    await db().begin(async tx => {
      await tx`update app_users set mfa_enabled = true, mfa_last_step = ${step}, recovery_codes = ${tx.json(hashed)}, updated_at = now() where id = ${session.user.id}`;
      if (isFounder) {
        // Primary key (id = true) makes this insert succeed exactly once, ever.
        await tx`insert into admin_bootstrap (admin_user_id, admin_email) values (${session.user.id}, ${r.email as string})`;
      }
      await tx`update sessions set mfa_passed = true where token_hash = ${session.tokenHash}`;
      await audit({ actor: { id: session.user.id, email: r.email as string }, action: isFounder ? "admin.bootstrap.completed" : "admin.mfa.enabled", targetType: "user", targetId: session.user.id }, tx);
    });
  } catch {
    return null;
  }
  return codes;
}

export async function verifyMfa(session: AuthSession, code: unknown, recovery: unknown): Promise<boolean> {
  const rows = await db()`select mfa_secret_enc, mfa_enabled, mfa_last_step, recovery_codes from app_users where id = ${session.user.id}`;
  const r = rows[0];
  if (!r?.mfa_enabled || !r.mfa_secret_enc) return false;
  const key = `mfa:${session.user.id}`;
  if (await isLocked([key])) return false;
  if (typeof recovery === "string" && recovery.trim()) {
    const h = sha256Hex(recovery.trim().toUpperCase());
    const list = (r.recovery_codes as string[]) ?? [];
    if (!list.includes(h)) { await recordFailure(key, 5); return false; }
    await db()`update app_users set recovery_codes = ${db().json(list.filter(x => x !== h))} where id = ${session.user.id}`;
    await audit({ actor: { id: session.user.id, email: session.user.email }, action: "admin.mfa.recovery_code_used", targetType: "user", targetId: session.user.id, details: { remaining: list.length - 1 } });
  } else {
    const step = typeof code === "string" ? verifyTotp(decryptString("mfa", r.mfa_secret_enc as string, session.user.id), code.trim()) : null;
    const last = r.mfa_last_step === null ? -1 : Number(r.mfa_last_step);
    if (step === null || step <= last) { await recordFailure(key, 5); return false; }
    // Conditional update prevents a concurrent replay of the same code.
    const ok = await db()`update app_users set mfa_last_step = ${step} where id = ${session.user.id} and coalesce(mfa_last_step, -1) < ${step} returning id`;
    if (!ok.length) return false;
  }
  await clearFailures(key);
  await db()`update sessions set mfa_passed = true where token_hash = ${session.tokenHash}`;
  return true;
}
