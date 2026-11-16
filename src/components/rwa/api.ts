"use client";

/** Same-origin JSON API helper. Only short, server-provided user messages are shown. */
export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string; data: Record<string, unknown> };

export async function api<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: init.method ?? (init.body !== undefined || init.form ? "POST" : "GET"),
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
      cache: "no-store",
      credentials: "same-origin"
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, status: res.status, data: data as T };
    // Only messages our server marked as user-facing are shown; anything else is replaced.
    const trusted = res.headers.get("x-nexora-message") === "1" && typeof data?.error === "string" && data.error.length < 300;
    const error = trusted ? data.error : res.status === 429 ? "Too many requests. Try again shortly." : "Something went wrong. Try again.";
    return { ok: false, status: res.status, error, data: trusted ? data ?? {} : {} };
  } catch {
    return { ok: false, status: 0, error: "Network unavailable. Check your connection and try again.", data: {} };
  }
}

export function fmtDate(value: unknown, withTime = false): string {
  if (!value) return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return "—";
  return withTime ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function fmtAmount(value: unknown, currency?: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  const text = Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 7 }) : String(value);
  return currency ? `${text} ${currency}` : text;
}

export const short = (v: unknown) => { const s = String(v ?? ""); return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-5)}` : s; };
