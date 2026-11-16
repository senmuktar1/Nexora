#!/usr/bin/env node
// Applies db/migrations/*.sql in order, once each, inside a transaction per file.
// Usage: DATABASE_URL=postgres://... npm run db:migrate
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set."); process.exit(1); }
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  await sql`alter table schema_migrations enable row level security`;
  const done = new Set((await sql`select name from schema_migrations`).map(r => r.name));
  const files = (await readdir(dir)).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort();
  for (const f of files) {
    if (done.has(f)) { console.log(`= ${f}`); continue; }
    const text = await readFile(path.join(dir, f), "utf8");
    await sql.begin(async tx => { await tx.unsafe(text); await tx`insert into schema_migrations (name) values (${f})`; });
    console.log(`+ ${f}`);
  }
  console.log("Database is up to date.");
} catch (e) {
  console.error("Migration failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
