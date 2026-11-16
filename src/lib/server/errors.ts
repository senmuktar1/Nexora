import "server-only";
import { NextResponse } from "next/server";

/**
 * Server-side error handling. Technical details are logged (redacted) with a
 * request ID; the client only ever receives a short, generic message.
 */

export const UNAVAILABLE = "Temporarily unavailable.";

const REDACTIONS: [RegExp, string][] = [
  [/\bS[A-Z2-7]{55}\b/g, "[redacted-secret]"],
  [/\b(sb_secret_|sk_|eyJ)[A-Za-z0-9._-]{10,}/g, "[redacted-token]"],
  [/(authorization|api[-_]?key|token|secret|password)(["'\s:=]+)[^\s"',}]+/gi, "$1$2[redacted]"],
  [/(https?:\/\/[^\s?"']+)\?[^\s"']*/g, "$1?[redacted-query]"]
];

export function redact(value: string): string {
  return REDACTIONS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value).slice(0, 2000);
}

export function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

export function logServerError(scope: string, error: unknown, requestId = newRequestId()): string {
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ level: "error", scope, requestId, name, message: redact(message), at: new Date().toISOString() }));
  return requestId;
}

/** Logs the error and returns the generic client-safe message. */
export function safeError(error: unknown, scope: string): string {
  logServerError(scope, error);
  return UNAVAILABLE;
}

/** Logs the error and returns a generic JSON error response with a correlation ID. */
export function errorResponse(error: unknown, scope: string, status = 502, extra: Record<string, unknown> = {}) {
  const requestId = logServerError(scope, error);
  return NextResponse.json({ ...extra, error: UNAVAILABLE, requestId }, { status, headers: { "Cache-Control": "no-store" } });
}
