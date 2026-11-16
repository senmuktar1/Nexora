import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { isAdminHost } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "NEXORA Administration", robots: { index: false, follow: false } };

/** Served only on ADMIN_HOST (also enforced by the proxy and every admin API). */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  if (!isAdminHost((await headers()).get("host"))) notFound();
  return <Suspense><AdminShell>{children}</AdminShell></Suspense>;
}
