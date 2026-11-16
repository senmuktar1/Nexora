import { NextRequest, NextResponse } from "next/server";
import { logServerError, safeError } from "@/lib/server/errors";
import { HORIZON } from "@/lib/server/horizon";
import { rateLimited } from "@/lib/server/rate-limit";
import { fetchStellarToml, TomlError } from "@/lib/server/toml";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const str = (v: unknown, max = 500) => typeof v === "string" ? v.slice(0, max) : null;
const url = (v: unknown) => { const s = str(v, 300); try { return s && new URL(s).protocol === "https:" ? s : null; } catch { return null; } };

/**
 * Evidence about an issued asset. Separates:
 *  - onChain: facts read from Stellar (authoritative)
 *  - domainLink: whether the issuer's home domain publishes this exact asset (SEP-1 two-way link)
 *  - published: what the issuer says about itself in stellar.toml (self-reported, unverified)
 */
export async function GET(request: NextRequest) {
  if (rateLimited(request, "issuer", 30)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const [code, issuer, extra] = (request.nextUrl.searchParams.get("asset") ?? "").split(":");
  if (extra !== undefined || !/^[A-Za-z0-9]{1,12}$/.test(code ?? "") || !/^G[A-Z2-7]{55}$/.test(issuer ?? "")) {
    return NextResponse.json({ error: "Invalid asset." }, { status: 400 });
  }
  try {
    const [accountRes, assetRes] = await Promise.all([
      fetch(`${HORIZON}/accounts/${issuer}`, { cache: "no-store", signal: AbortSignal.timeout(8000) }),
      fetch(`${HORIZON}/assets?asset_code=${encodeURIComponent(code)}&asset_issuer=${issuer}`, { cache: "no-store", signal: AbortSignal.timeout(8000) })
    ]);
    if (accountRes.status === 404) return NextResponse.json({ status: "issuer_not_found" });
    if (!accountRes.ok || !assetRes.ok) throw new Error(`Horizon issuer HTTP ${accountRes.status}/${assetRes.status}`);
    const account = await accountRes.json() as Record<string, unknown>;
    const assets = await assetRes.json() as { _embedded?: { records?: Record<string, unknown>[] } };
    const asset = assets._embedded?.records?.[0] ?? null;
    const flags = (account.flags ?? {}) as Record<string, boolean>;
    const thresholds = (account.thresholds ?? {}) as Record<string, number>;
    const signers = (account.signers ?? []) as { key: string; weight: number }[];
    const totalWeight = signers.reduce((s, x) => s + x.weight, 0);
    const accounts = (asset?.accounts ?? {}) as Record<string, number>;
    const balances = (asset?.balances ?? {}) as Record<string, string>;
    const homeDomain = str(account.home_domain, 253);

    const onChain = {
      exists: asset !== null,
      authRequired: !!flags.auth_required,
      authRevocable: !!flags.auth_revocable,
      authImmutable: !!flags.auth_immutable,
      clawbackEnabled: !!flags.auth_clawback_enabled,
      // Minting is a payment (medium threshold): locked when signers can no longer reach it.
      issuerLocked: totalWeight < Math.max(1, thresholds.med_threshold ?? 0),
      holders: typeof accounts.authorized === "number" ? accounts.authorized : null,
      circulating: balances.authorized ?? null,
      homeDomain
    };

    let domainLink: { status: "linked" | "not_listed" | "no_domain" | "unavailable" } = { status: homeDomain ? "unavailable" : "no_domain" };
    let published: Record<string, unknown> | null = null;
    if (homeDomain) {
      try {
        const toml = await fetchStellarToml(homeDomain);
        const currencies = Array.isArray(toml.CURRENCIES) ? toml.CURRENCIES as Record<string, unknown>[] : [];
        const entry = currencies.find(c => c.code === code && c.issuer === issuer);
        const doc = (toml.DOCUMENTATION ?? {}) as Record<string, unknown>;
        domainLink = { status: entry ? "linked" : "not_listed" };
        if (entry) published = {
          orgName: str(doc.ORG_NAME, 120), orgUrl: url(doc.ORG_URL),
          name: str(entry.name, 120), description: str(entry.desc), image: url(entry.image),
          isAnchored: entry.is_asset_anchored === true, anchorAssetType: str(entry.anchor_asset_type, 40), anchorAsset: str(entry.anchor_asset, 120),
          attestation: url(entry.attestation_of_reserve), redemption: str(entry.redemption_instructions),
          regulated: entry.regulated === true, approvalServer: url(entry.approval_server), approvalCriteria: str(entry.approval_criteria),
          conditions: str(entry.conditions), status: str(entry.status, 20), fixedNumber: entry.fixed_number === true
        };
      } catch (error) {
        if (error instanceof TomlError && (error.code === "not_found" || error.code === "invalid_toml")) domainLink = { status: "not_listed" };
        else logServerError("stellar/issuer:toml", error);
      }
    }
    return NextResponse.json({ status: "ok", asset: `${code}:${issuer}`, onChain, domainLink, published, retrievedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "public, s-maxage=120" } });
  } catch (error) {
    return NextResponse.json({ error: safeError(error, "stellar/issuer") }, { status: 502 });
  }
}
