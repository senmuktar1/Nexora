"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { api, fmtDate } from "@/components/rwa/api";
import { Empty, Notice } from "@/components/rwa/ui";
import { AdminHeading } from "./AdminOverview";

type E = { id: string; actor_email: string | null; action: string; target_type: string | null; target_id: string | null; previous_status: string | null; new_status: string | null; reason: string | null; details: Record<string, unknown>; created_at: string };

export default function AdminAudit() {
  const [action, setAction] = useState("");
  const [rows, setRows] = useState<E[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async (prefix: string, before: string | null) => {
    const qs = new URLSearchParams();
    if (prefix) qs.set("action", prefix);
    if (before) qs.set("before", before);
    const r = await api<{ entries: E[]; next: string | null }>(`/api/admin/audit?${qs}`);
    if (!r.ok) { setError(r.error); return; }
    setRows(x => before ? [...x, ...r.data.entries] : r.data.entries);
    setNext(r.data.next);
    setLoaded(true);
  }, []);
  useEffect(() => { const t = window.setTimeout(() => void load("", null), 0); return () => window.clearTimeout(t); }, [load]);
  return <>
    <AdminHeading kicker="ACCOUNTABILITY" title="Audit log"/>
    <form className="nx-directory-search nx-admin-search" onSubmit={e => { e.preventDefault(); void load(action.trim(), null); }}>
      <Search size={15}/><input value={action} onChange={e => setAction(e.target.value)} placeholder="Filter by action prefix, e.g. rwa. or admin.login" aria-label="Filter by action"/><button>Filter</button>
    </form>
    {error && <Notice kind="error">{error}</Notice>}
    {loaded && rows.length === 0 && <Empty>No entries.</Empty>}
    {rows.length > 0 && <div className="nx-admin-table">
      <div className="nx-admin-tr nx-admin-th"><span>Time</span><span>Actor</span><span>Action</span><span>Target</span><span>Change / reason</span></div>
      {rows.map(e => <div key={e.id} className="nx-admin-tr">
        <span>{fmtDate(e.created_at, true)}</span>
        <span>{e.actor_email ?? "anonymous"}</span>
        <span><code>{e.action}</code></span>
        <span>{e.target_type === "rwa_application" && e.target_id ? <Link href={`/admin/applications/${e.target_id}`}>{e.target_id}</Link> : e.target_id ?? "—"}</span>
        <span>{e.previous_status || e.new_status ? `${e.previous_status ?? "—"} → ${e.new_status ?? "—"}` : ""}{e.reason ? <small>{e.reason}</small> : null}
          {Object.keys(e.details ?? {}).length > 0 && <small className="nx-admin-details">{Object.entries(e.details).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ")}</small>}</span>
      </div>)}
    </div>}
    {next && <div className="nx-rwa-actions"><button className="nx-rwa-button" onClick={() => void load(action.trim(), next)}>Load older entries</button></div>}
  </>;
}
