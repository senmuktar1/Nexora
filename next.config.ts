import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Strict CSP: the browser holds the user's encrypted wallet, so the page may only
 * talk to its own origin. All Stellar/Soroban/provider traffic goes through /api.
 * Next.js App Router hydration requires inline scripts; dev mode also needs eval.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"])
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // HSTS preload is a long-term commitment for the whole domain; opt in with HSTS_PRELOAD=true.
  { key: "Strict-Transport-Security", value: `max-age=63072000; includeSubDomains${process.env.HSTS_PRELOAD === "true" ? "; preload" : ""}` }
];

const nextConfig: NextConfig = {
  // NEXT_OUTPUT=standalone produces a self-contained server (.next/standalone) for container hosts.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  poweredByHeader: false,
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  }
};

export default nextConfig;
