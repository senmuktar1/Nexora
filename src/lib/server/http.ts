import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { logServerError, UNAVAILABLE } from "@/lib/server/errors";
import { DbUnavailable } from "@/lib/server/db";
import { EncryptionUnavailable } from "@/lib/server/crypto";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * JSON response. Error responses carry X-Nexora-Message so the browser only shows error
 * text that this server wrote for users (never a proxy's or platform's error body).
 */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...(status >= 400 ? { "X-Nexora-Message": "1" } : {}), ...headers } });
}

export const fail = (message: string, status = 400) => json({ error: message }, status);

/** Route-level error handler: never leaks internals; reports missing configuration plainly. */
export function serverFailure(error: unknown, scope: string) {
  if (error instanceof HttpError) return fail(error.message, error.status);
  if (error instanceof DbUnavailable) return fail("Accounts aren't available yet: the database isn't configured.", 503);
  if (error instanceof EncryptionUnavailable) return fail("Secure storage isn't configured yet.", 503);
  const requestId = logServerError(scope, error);
  return json({ error: UNAVAILABLE, requestId }, 500);
}

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function hostnameOf(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/:\d+$/, "");
}

/** The configured admin host (e.g. admin.nexora.com). Unset = admin portal disabled. */
export function adminHost(env: NodeJS.ProcessEnv = process.env): string {
  return hostnameOf(env.ADMIN_HOST);
}

export function isAdminHost(host: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const admin = adminHost(env);
  return !!admin && hostnameOf(host) === admin;
}

/**
 * CSRF defence for state-changing requests: the browser-set Origin must match the
 * request host. (Cookies are also SameSite=Strict.)
 */
export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host.toLowerCase() === host.toLowerCase(); } catch { return false; }
}

export async function readJson<T extends Record<string, unknown>>(request: NextRequest, maxBytes = 64_000): Promise<T> {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request too large.");
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as T;
  } catch {
    throw new HttpError(400, "Invalid request.");
  }
}

export function str(value: unknown, max: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new HttpError(400, "Invalid request.");
  const v = value.trim();
  if (v.length > max) throw new HttpError(400, `A field is too long (max ${max} characters).`);
  return v;
}

export function normaliseEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return null;
  return v;
}

/** Absolute origin for links in emails (validated host only). */
export function originOf(request: NextRequest): string {
  const host = request.headers.get("host") ?? "";
  const proto = request.headers.get("x-forwarded-proto") === "http" || request.nextUrl.protocol === "http:" ? "http" : "https";
  return `${proto}://${host}`;
}

type Ctx<P> = { params: Promise<P> };
/** Wraps a route handler with uniform, non-leaking error handling. */
export function route<P = Record<string, never>>(scope: string, fn: (request: NextRequest, params: P) => Promise<Response>) {
  return async (request: NextRequest, context: Ctx<P>): Promise<Response> => {
    try {
      return await fn(request, (await context?.params) ?? ({} as P));
    } catch (e) {
      return serverFailure(e, scope);
    }
  };
}
