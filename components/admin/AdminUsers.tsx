"use client";

import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { api, fmtDate } from "@/components/rwa/api";
import { Empty, Field, Notice, StatusBadge } from "@/components/rwa/ui";
import { useAdmin } from "./AdminShell";
import { AdminHeading } from "./AdminOverview";

type U = { id: string; realm: string; email: string; role: string; status: string; mfa_enabled: boolean; stellar_address: string | null; created_at: string; last_login_at: string | null; applications: number; approved_assets: number; subscriptions: number };

export default function AdminUsers() {
  const { permissions } = useAdmin();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<U[] | null>(null);
  const [error, setError] = useState("");
  const [acting, setActing] = useState<U | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const load = useCallback(async (query = "") => {
    const r = await api<{ users: U[] }>(`/api/admin/users${query ? `?q=${encodeURIComponent(query)}` : ""}`);
    if (r.ok) setRows(r.data.users); else setError(r.error);
  }, []);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);
  const canManage = permissions.includes("users.manage");
  const action = acting?.status === "suspended" ? "reactivate" : "suspend";

  return <>
    <AdminHeading kicker="ACCOUNTS" title="Users & issuers"/>
    <form className="nx-directory-search nx-admin-search" onSubmit={e => { e.preventDefault(); void load(q.trim()); }}>
      <Search size={15}/><input value={q} onChange={e => setQ(e.target.value)} placeholder="Email or Stellar address" aria-label="Search users"/><button>Search</button>
    </form>
    {error && <Notice kind="error">{error}</Notice>}
    {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    {acting && <form className="nx-panel nx-admin-form" onSubmit={async e => {
      e.preventDefault();
      const r = await api(`/api/admin/users/${acting.id}`, { body: { action, reason } });
      if (r.ok) { setMsg({ kind: "success", text: `${acting.email}: ${action === "suspend" ? "suspended" : "reactivated"}.` }); setActing(null); setReason(""); void load(q.trim()); }
      else setMsg({ kind: "error", text: r.error });
    }}>
      <strong>{action === "suspend" ? "Suspend" : "Reactivate"} {acting.email}</strong>
      {action === "suspend" && <p className="nx-admin-help">Suspension signs the account out everywhere and blocks sign-in. On-chain assets are not affected.</p>}
      <Field label="Reason (recorded in the audit log)"><input className="nx-wallet-input" value={reason} onChange={e => setReason(e.target.value)} minLength={5} required/></Field>
      <div className="nx-rwa-actions"><button className={action === "suspend" ? "nx-rwa-button danger" : "nx-rwa-button primary"}>Confirm</button><button type="button" className="nx-rwa-button" onClick={() => setActing(null)}>Cancel</button></div>
    </form>}
    {rows && rows.length === 0 && <Empty>No accounts match.</Empty>}
    {rows && rows.length > 0 && <div className="nx-admin-table">
      <div className="nx-admin-tr nx-admin-th"><span>Account</span><span>Type</span><span>Activity</span><span>Joined</span><span>Status</span></div>
      {rows.map(u => <div key={u.id} className="nx-admin-tr">
        <span><strong>{u.email}</strong>{u.stellar_address && <small><code>{u.stellar_address}</code></small>}</span>
        <span>{u.realm === "admin" ? (u.role === "super_admin" ? "Super Admin" : `Staff · ${u.role}`) : u.applications ? "Issuer / applicant" : "Investor"}{u.realm === "admin" && <small>{u.mfa_enabled ? "2FA on" : "2FA not set"}</small>}</span>
        <span>{u.applications} applications · {u.approved_assets} approved<small>{u.subscriptions} subscriptions · last sign-in {fmtDate(u.last_login_at)}</small></span>
        <span>{fmtDate(u.created_at)}</span>
        <span><StatusBadge kind="other" status={u.status}/>{canManage && u.role !== "super_admin" && <button className="nx-rwa-button" onClick={() => { setActing(u); setReason(""); setMsg(null); }}>{u.status === "suspended" ? "Reactivate" : "Suspend"}</button>}</span>
      </div>)}
    </div>}
  </>;
}
