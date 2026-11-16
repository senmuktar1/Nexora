"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, fmtAmount, fmtDate } from "@/components/rwa/api";
import { Empty, Notice, StatusBadge } from "@/components/rwa/ui";
import { RWA_CATEGORIES, type RwaCategory } from "@/lib/rwa";
import { AdminHeading } from "./AdminOverview";
import { OnChainFacts } from "./AdminApplicationDetail";

type Row = Record<string, unknown>;

export default function AdminAssets() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [chain, setChain] = useState<Record<string, Row | string>>({});
  useEffect(() => { void api<{ assets: Row[] }>("/api/admin/assets").then(r => r.ok ? setRows(r.data.assets) : setError(r.error)); }, []);
  return <>
    <AdminHeading kicker="APPROVED ASSETS" title="Assets & tokens"/>
    {error && <Notice kind="error">{error}</Notice>}
    {rows && rows.length === 0 && <Empty>No approved assets yet.</Empty>}
    {rows && rows.length > 0 && <div className="nx-rwa-cards">{rows.map(a => {
      const ref = String(a.reference);
      const c = chain[ref];
      return <article key={ref} className="nx-panel nx-rwa-card">
        <div className="nx-rwa-card-head"><div><code>{ref}</code><h3>{String(a.asset_name)}</h3><small>{RWA_CATEGORIES[a.category as RwaCategory]}</small></div>
          <div className="nx-admin-heading-badges"><StatusBadge status={String(a.status)}/>{a.token_status ? <StatusBadge kind="token" status={String(a.token_status)}/> : <StatusBadge status="draft" label="Not configured"/>}{a.published ? <StatusBadge status="approved" label="Listed"/> : null}</div></div>
        <dl className="nx-rwa-facts nx-rwa-facts-compact">
          <div><dt>Token</dt><dd>{a.token_code ? String(a.token_code) : "—"}</dd></div>
          <div><dt>Supply</dt><dd>{fmtAmount(a.total_supply)}</dd></div>
          <div><dt>Issued</dt><dd>{fmtDate(a.issued_at)}</dd></div>
          <div><dt>Investors delivered</dt><dd>{String(a.holders)}</dd></div>
          <div><dt>Open items</dt><dd>{String(a.open_items)}</dd></div>
          {a.token_status === "authorized" && <div><dt>Authorization expires</dt><dd>{fmtDate(a.authorization_expires_at, true)}</dd></div>}
        </dl>
        <div className="nx-rwa-actions">
          <Link className="nx-rwa-button primary" href={`/admin/applications/${ref}#tokenization`}>Manage</Link>
          {a.token_status === "issued" && <button className="nx-rwa-button" onClick={async () => {
            const r = await api<{ onChain: Row }>(`/api/admin/assets/${ref}`);
            setChain(x => ({ ...x, [ref]: r.ok ? r.data.onChain : r.error }));
          }}>Check on-chain state</button>}
        </div>
        {typeof c === "string" && <Notice kind="error">{c}</Notice>}
        {c && typeof c === "object" && <OnChainFacts data={c}/>}
      </article>;
    })}</div>}
  </>;
}
