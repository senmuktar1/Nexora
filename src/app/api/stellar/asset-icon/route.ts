import { NextRequest, NextResponse } from "next/server";
import { logServerError } from "@/lib/server/errors";
import { HORIZON } from "@/lib/server/horizon";
import { sniffImage } from "@/lib/server/image";
import { rateLimited } from "@/lib/server/rate-limit";
import { fetchStellarToml, safeFetch, TomlError } from "@/lib/server/toml";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MAX_ICON_BYTES = 200_000;
const notFound = () => new NextResponse(null, { status: 404, headers: { "Cache-Control": "public, s-maxage=3600" } });

/**
 * Token icon for CODE:ISSUER, served only when the issuer's home domain lists this exact
 * asset in stellar.toml (SEP-1 two-way link). Raster formats only, verified by magic bytes.
 */
export async function GET(request: NextRequest) {
  if (rateLimited(request, "asset-icon", 120)) return new NextResponse(null, { status: 429 });
  const [code, issuer, extra] = (request.nextUrl.searchParams.get("asset") ?? "").split(":");
  if (extra !== undefined || !/^[A-Za-z0-9]{1,12}$/.test(code ?? "") || !/^G[A-Z2-7]{55}$/.test(issuer ?? "")) return new NextResponse(null, { status: 400 });
  try {
    const account = await fetch(`${HORIZON}/accounts/${issuer}`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!account.ok) return notFound();
    const homeDomain = (await account.json() as { home_domain?: string }).home_domain;
    if (!homeDomain) return notFound();
    const toml = await fetchStellarToml(homeDomain);
    const entry = (Array.isArray(toml.CURRENCIES) ? toml.CURRENCIES as Record<string, unknown>[] : []).find(c => c.code === code && c.issuer === issuer);
    if (!entry || typeof entry.image !== "string") return notFound();
    const { bytes } = await safeFetch(entry.image, MAX_ICON_BYTES, "image/png,image/jpeg,image/webp,image/gif");
    const type = sniffImage(bytes);
    if (!type) return notFound();
    return new NextResponse(new Uint8Array(bytes), { headers: {
      "Content-Type": type, "Cache-Control": "public, max-age=86400, s-maxage=86400",
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox"
    } });
  } catch (error) {
    if (!(error instanceof TomlError)) logServerError("stellar/asset-icon", error);
    return notFound();
  }
}
