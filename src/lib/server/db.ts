import "server-only";
import postgres from "postgres";

/**
 * PostgreSQL (Supabase-compatible) access, server-side only. DATABASE_URL is a private
 * server variable; it is never sent to the browser. `prepare: false` keeps the client
 * compatible with Supabase's transaction pooler (port 6543).
 */
type Sql = postgres.Sql<Record<string, unknown>>;
let client: Sql | null = null;

export function dbConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.DATABASE_URL?.trim();
}

export class DbUnavailable extends Error {
  constructor() { super("database_not_configured"); }
}

export function db(): Sql {
  if (client) return client;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new DbUnavailable();
  client = postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {}
  }) as unknown as Sql;
  return client;
}

/** Test hook: close the pool. */
export async function __closeDbForTests() {
  if (client) { await client.end({ timeout: 1 }); client = null; }
}
