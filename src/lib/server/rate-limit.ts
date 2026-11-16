import "server-only";
import type { NextRequest } from "next/server";

/**
 * Best-effort fixed-window limiter per client IP and route. In-memory state is per
 * server instance, so on serverless it limits bursts rather than enforcing a global
 * quota; pair with the hosting platform's firewall/WAF rules for hard limits.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Client IP from the header the hosting platform itself sets (never a header a client
 * could forge on that platform):
 *  - Netlify: x-nf-client-connection-ip (x-forwarded-for carries the edge IP there)
 *  - Vercel and reverse proxies (Caddy/Nginx/most PaaS): first x-forwarded-for entry
 * TRUSTED_CLIENT_IP_HEADER overrides this for other setups.
 */
export function clientKey(request: NextRequest, env: NodeJS.ProcessEnv = process.env): string {
  const h = request.headers;
  const custom = env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  const pick = custom ? h.get(custom)
    : env.NETLIFY === "true" ? h.get("x-nf-client-connection-ip")
    : h.get("x-forwarded-for") ?? h.get("x-real-ip");
  return pick?.split(",")[0]?.trim() || "unknown";
}

export function rateLimited(request: NextRequest, scope: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const key = `${scope}:${clientKey(request)}`;
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}
