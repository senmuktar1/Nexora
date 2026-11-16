import "server-only";
import { db } from "@/lib/server/db";

/**
 * Database-backed sign-in throttling (shared across server instances): after
 * `max` failures within the window the key is locked for `lockMinutes`.
 */
export async function isLocked(keys: string[]): Promise<boolean> {
  const rows = await db()`select 1 from login_attempts where key = any(${keys}) and locked_until > now() limit 1`;
  return rows.length > 0;
}

export async function recordFailure(key: string, max: number, windowMinutes = 15, lockMinutes = 15) {
  await db()`
    insert into login_attempts as a (key, failures, window_start) values (${key}, 1, now())
    on conflict (key) do update set
      failures = case when a.window_start < now() - ${windowMinutes} * interval '1 minute' then 1 else a.failures + 1 end,
      window_start = case when a.window_start < now() - ${windowMinutes} * interval '1 minute' then now() else a.window_start end,
      locked_until = case
        when a.window_start >= now() - ${windowMinutes} * interval '1 minute' and a.failures + 1 >= ${max}
        then now() + ${lockMinutes} * interval '1 minute' else a.locked_until end`;
}

export async function clearFailures(key: string) {
  await db()`delete from login_attempts where key = ${key}`;
}
