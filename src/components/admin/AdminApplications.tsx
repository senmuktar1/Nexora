"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { api, fmtDate } from "@/components/rwa/api";
import { Empty, Notice, StatusBadge } from "@/components/rwa/ui";
import { RWA_CATEGORIES, RWA_STATUSES, type RwaCategory } from "@/lib/rwa";
import { AdminHeading } from "./AdminOverview";

type Row = { reference: string; status: string; category: RwaCategory; asset_name: string; issuer_legal_name: string; country: string; submitted_at: string; owner_email: string; token_status: string | null; published: boolean };

export default function AdminApplications() {
  const params = useSearchParams();
  const router = useRouter();
  const status = params.get("status") ?? "";
  const [q, setQ] = useState(params.get("q") ?? "");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (params.get("q")) qs.set("q", params.get("q")!);
    void api<{ applications: Row[] }>(`/api/admin/applications?${qs}`).then(r => { if (r.ok) { setRows(r.data.applications); setError(""); } else setError(r.error); });
  }, [status, params]);

  const go = (next: { status?: string; q?: string }) => {
    const qs = new URLSearchParams();
    const s = next.status ?? status, query = next.q ?? q;
    if (s) qs.set("status", s);
    if (query.trim()) qs.set("q", query.trim());
    router.push(`/admin/applications${qs.size ? `?${qs}` : ""}`);
  };

  return <>
    <AdminHeading kicker="RWA REVIEW" title="Applications"/>
    <div className="nx-admin-toolbar">
      <div className="nx-admin-tabs" role="tablist">
        {[["", "All"], ...Object.entries(RWA_STATUSES).filter(([k]) => k !== "draft")].map(([k, label]) =>
          <button key={k} role="tab" aria-selected={status === k} className={status === k ? "active" : undefined} onClick={() => go({ status: k })}>{label}</button>)}
      </div>
      <form className="nx-directory-search nx-admin-search" onSubmit={e => { e.preventDefault(); go({ q }); }}>
        <Search size={15}/><input value={q} onChange={e => setQ(e.target.value)} placeholder="Reference, asset, issuer or email" aria-label="Search applications"/><button>Search</button>
      </form>
    </div>
    {error && <Notice kind="error">{error}</Notice>}
    {rows && rows.length === 0 && <Empty>No applications match.</Empty>}
    {rows && rows.length > 0 && <div className="nx-admin-table">
      <div className="nx-admin-tr nx-admin-th" aria-hidden="true"><span>Reference</span><span>Asset</span><span>Issuer</span><span>Submitted</span><span>Status</span></div>
      {rows.map(r => <Link key={r.reference} href={`/admin/applications/${r.reference}`} className="nx-admin-tr">
        <span><code>{r.reference}</code></span>
        <span><strong>{r.asset_name}</strong><small>{RWA_CATEGORIES[r.category]} · {r.country || "—"}</small></span>
        <span>{r.issuer_legal_name || "—"}<small>{r.owner_email}</small></span>
        <span>{fmtDate(r.submitted_at)}</span>
        <span><StatusBadge status={r.status}/>{r.token_status && <StatusBadge kind="token" status={r.token_status}/>}</span>
      </Link>)}
    </div>}
  </>;
}
