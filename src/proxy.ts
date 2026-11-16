import { NextResponse, type NextRequest } from "next/server";
import { ALWAYS_ALLOWED, countryFromHeaders, parseCountryList } from "@/lib/region";

const NO_STORE = { "Cache-Control": "no-store" };
const hostnameOf = (v: string | null | undefined) => (v ?? "").trim().toLowerCase().replace(/:\d+$/, "");

/**
 * 1. Host separation: the admin portal (/admin, /api/admin) is served only on ADMIN_HOST
 *    (e.g. admin.nexora.com); everywhere else it doesn't exist (404). The admin host
 *    serves nothing but the portal. Unset ADMIN_HOST = portal disabled.
 * 2. Regional access control (no-op unless RESTRICTED_COUNTRIES is set).
 */
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const adminHost = hostnameOf(process.env.ADMIN_HOST);
  const onAdminHost = !!adminHost && hostnameOf(request.headers.get("host")) === adminHost;
  const adminPage = path === "/admin" || path.startsWith("/admin/");
  const adminApi = path.startsWith("/api/admin/");

  if (onAdminHost) {
    if (adminPage || adminApi || path === "/api/health") return NextResponse.next({ headers: NO_STORE });
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Not found." }, { status: 404, headers: NO_STORE });
    const url = request.nextUrl.clone();
    url.pathname = "/admin";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (adminApi) return NextResponse.json({ error: "Not found." }, { status: 404, headers: NO_STORE });
  if (adminPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/__not-found";
    return NextResponse.rewrite(url, { headers: NO_STORE });
  }

  const restricted = parseCountryList(process.env.RESTRICTED_COUNTRIES);
  if (restricted.size === 0) return NextResponse.next();
  const country = countryFromHeaders(request.headers);
  if (!country || !restricted.has(country)) return NextResponse.next();
  if (ALWAYS_ALLOWED.some(p => path === p || path.startsWith(p + "/"))) return NextResponse.next();
  if (path.startsWith("/api/")) {
    return NextResponse.json({ error: "NEXORA isn't available in your region." }, { status: 451, headers: NO_STORE });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/restricted-regions";
  url.search = "?blocked=1";
  return NextResponse.rewrite(url, { headers: NO_STORE });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|nexora-mark.svg|contracts/).*)"]
};
