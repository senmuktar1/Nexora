import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { NextRequest } from "next/server";

/** Integration tests run against a real PostgreSQL database given by TEST_DATABASE_URL. */
export const TEST_DB = process.env.TEST_DATABASE_URL ?? "";

/** A fresh database per test file (files run in parallel): <TEST_DATABASE_URL db>_<suffix>. */
export async function freshDatabase(suffix: string): Promise<string> {
  const base = new URL(TEST_DB);
  const name = `${base.pathname.slice(1) || "nexora_test"}_${suffix}`;
  // Create/drop via the server's maintenance database, so TEST_DATABASE_URL's own database needn't exist.
  const maintenance = new URL(TEST_DB);
  maintenance.pathname = "/postgres";
  const admin = postgres(maintenance.toString(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin.unsafe(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  base.pathname = `/${name}`;
  const url = base.toString();
  await resetDatabase(url);
  return url;
}

export async function resetDatabase(url: string) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe("drop schema if exists public cascade; create schema public;");
    const dir = path.join(__dirname, "..", "..", "db", "migrations");
    for (const f of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) await sql.unsafe(readFileSync(path.join(dir, f), "utf8"));
  } finally {
    await sql.end();
  }
}

export type Jar = Map<string, string>;
export const newJar = (): Jar => new Map();

type CallOpts = { method?: string; host: string; path: string; body?: unknown; form?: FormData; jar?: Jar; origin?: string | null; headers?: Record<string, string> };

/** Builds a NextRequest, calls a route handler, and stores Set-Cookie values in the jar. */
export async function call(handler: (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>, opts: CallOpts, params: Record<string, string> = {}) {
  const method = opts.method ?? (opts.body !== undefined || opts.form ? "POST" : "GET");
  const headers = new Headers({ host: opts.host, ...(opts.headers ?? {}) });
  if (opts.origin !== null && method !== "GET") headers.set("origin", opts.origin ?? `https://${opts.host}`);
  if (opts.jar?.size) headers.set("cookie", [...opts.jar].map(([k, v]) => `${k}=${v}`).join("; "));
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers.set("content-type", "application/json"); }
  const req = new NextRequest(`https://${opts.host}${opts.path}`, { method, headers, body });
  const res = await handler(req, { params: Promise.resolve(params) });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const [k, ...rest] = pair.split("=");
    const v = rest.join("=");
    if (opts.jar) { if (v) opts.jar.set(k, v); else opts.jar.delete(k); }
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* binary */ }
  return { status: res.status, json, text, headers: res.headers };
}
