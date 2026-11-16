import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { parse } from "smol-toml";

/**
 * Fetches https://<domain>/.well-known/stellar.toml with SSRF protections:
 * HTTPS only, hostname syntax check, no IP literals, resolved addresses must be
 * public, no redirects, 100 KB cap, 6 s timeout.
 */

const MAX_BYTES = 100_000;

export class TomlError extends Error {
  constructor(public readonly code: "invalid_domain" | "blocked_address" | "not_found" | "too_large" | "invalid_toml" | "unavailable") { super(code); }
}

export function isPublicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return false;
    return true;
  }
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:")) return false;
    return true;
  }
  return false;
}

export function validDomain(domain: string): boolean {
  return /^(?=.{1,253}$)(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(domain) && isIP(domain) === 0 && !domain.endsWith(".local") && !domain.endsWith(".internal");
}

async function assertPublicHost(domain: string, resolve: typeof lookup) {
  if (!validDomain(domain)) throw new TomlError("invalid_domain");
  const addresses = await resolve(domain, { all: true }).catch(() => { throw new TomlError("unavailable"); });
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new TomlError("blocked_address");
}

/** GET an https URL on a public host: no redirects, size-capped. Returns body bytes and content type. */
export async function safeFetch(urlString: string, maxBytes: number, accept: string, resolve = lookup): Promise<{ bytes: Buffer; contentType: string }> {
  let url: URL;
  try { url = new URL(urlString); } catch { throw new TomlError("invalid_domain"); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new TomlError("invalid_domain");
  await assertPublicHost(url.hostname.toLowerCase(), resolve);
  const response = await fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(6000), headers: { Accept: accept } })
    .catch(() => { throw new TomlError("unavailable"); });
  if (response.status === 404) throw new TomlError("not_found");
  if (!response.ok) throw new TomlError("unavailable");
  if (Number(response.headers.get("content-length") ?? 0) > maxBytes) throw new TomlError("too_large");
  const reader = response.body?.getReader();
  if (!reader) throw new TomlError("unavailable");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) { await reader.cancel(); throw new TomlError("too_large"); }
    chunks.push(value);
  }
  return { bytes: Buffer.concat(chunks), contentType: (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() };
}

export async function fetchStellarToml(domainInput: string, resolve = lookup): Promise<Record<string, unknown>> {
  const domain = domainInput.trim().toLowerCase();
  if (!validDomain(domain)) throw new TomlError("invalid_domain");
  const { bytes } = await safeFetch(`https://${domain}/.well-known/stellar.toml`, MAX_BYTES, "text/plain", resolve);
  const text = new TextDecoder().decode(bytes);
  try { return parse(text) as Record<string, unknown>; } catch { throw new TomlError("invalid_toml"); }
}
