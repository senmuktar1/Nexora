/**
 * Owner-configured regional restrictions. Nothing is restricted unless the owner sets
 * RESTRICTED_COUNTRIES (ISO 3166-1 alpha-2 codes, comma-separated). The visitor's country
 * is read only from the header the hosting platform itself sets.
 */
export function parseCountryList(raw: string | undefined): Set<string> {
  return new Set((raw ?? "").split(",").map(c => c.trim().toUpperCase()).filter(c => /^[A-Z]{2}$/.test(c)));
}

export function countryFromHeaders(headers: Headers, env: NodeJS.ProcessEnv = process.env): string | null {
  const custom = env.GEO_COUNTRY_HEADER?.trim().toLowerCase();
  const value = custom ? headers.get(custom)
    : env.VERCEL === "1" ? headers.get("x-vercel-ip-country")
    : env.NETLIFY === "true" ? headers.get("x-country")
    : null;
  const code = value?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

/** Paths that stay reachable from restricted regions (legal information, health, static files). */
export const ALWAYS_ALLOWED = ["/restricted-regions", "/terms", "/privacy", "/risk-disclosure", "/wallet-security", "/api/health"];
