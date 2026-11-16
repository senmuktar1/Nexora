"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { api, fmtDate } from "@/components/rwa/api";
import { Empty, Notice, Section } from "@/components/rwa/ui";
import { RWA_STATUSES } from "@/lib/rwa";

type Overview = {
  applications: Record<string, number>; tokens: Record<string, number>; subscriptions: Record<string, number>;
  users: number; openItems: number; recent: { action: string; target_id: string | null; new_status: string | null; created_at: string; actor_email: string | null }[];
};

export function AdminHeading({ kicker, title, children }: { kicker: string; title: string; children?: React.ReactNode }) {
  return <div className="nx-page-heading nx-admin-heading"><div><div className="nx-eyebrow">{kicker}</div><h1>{title}</h1></div>{children}</div>;
}

export default function AdminOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { void api<Overview>("/api/admin/overview").then(r => r.ok ? setData(r.data) : setError(r.error)); }, []);
  const queue = (data?.applications.submitted ?? 0) + (data?.applications.under_review ?? 0);
  return <>
    <AdminHeading kicker="ADMINISTRATION" title="Overview"/>
    {error && <Notice kind="error">{error}</Notice>}
    {data && <>
      <div className="nx-admin-stats">
        <Link href="/admin/applications?status=submitted" className="nx-admin-stat"><span>Review queue</span><strong>{queue}</strong><small>submitted + under review</small></Link>
        <Link href="/admin/applications?status=info_requested" className="nx-admin-stat"><span>Awaiting applicant</span><strong>{data.applications.info_requested ?? 0}</strong><small>information requested</small></Link>
        <Link href="/admin/assets" className="nx-admin-stat"><span>Tokens to authorise</span><strong>{data.tokens.submitted ?? 0}</strong><small>{data.tokens.issued ?? 0} issued</small></Link>
        <Link href="/admin/assets" className="nx-admin-stat"><span>Open lifecycle items</span><strong>{data.openItems}</strong><small>redemptions & incidents</small></Link>
        <Link href="/admin/users" className="nx-admin-stat"><span>Accounts</span><strong>{data.users}</strong><small>applicants & investors</small></Link>
      </div>
      <div className="nx-admin-grid-2">
        <Section kicker="APPLICATIONS" title="By status">
          <div className="nx-admin-status-list">{(Object.keys(RWA_STATUSES) as (keyof typeof RWA_STATUSES)[]).filter(s => s !== "draft").map(s =>
            <Link key={s} href={`/admin/applications?status=${s}`}><span>{RWA_STATUSES[s]}</span><strong>{data.applications[s] ?? 0}</strong></Link>)}</div>
        </Section>
        <Section kicker="AUDIT" title="Recent activity" actions={<Link className="nx-text-link" href="/admin/audit">Full log <ArrowUpRight size={13}/></Link>}>
          {data.recent.length === 0 ? <Empty>No activity yet.</Empty> : <ul className="nx-admin-feed">{data.recent.map((r, i) =>
            <li key={i}><strong>{r.action}</strong><span>{r.target_id ?? ""}{r.new_status ? ` → ${r.new_status}` : ""}</span><small>{r.actor_email ?? "system"} · {fmtDate(r.created_at, true)}</small></li>)}</ul>}
        </Section>
      </div>
    </>}
  </>;
}
