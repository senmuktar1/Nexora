"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Building2, LoaderCircle, LogOut, UserRound } from "lucide-react";
import { useStellarWallet } from "@/components/wallet/WalletProvider";
import { ClientError, loadAccount, loadFeePerOperation, submitSigned } from "@/lib/stellar/client";
import { buildRwaTrustline, RwaOpError } from "@/lib/stellar/rwa-ops";
import { guardMessage, TxGuardError } from "@/lib/stellar/tx-guard";
import { api, fmtAmount, fmtDate, short } from "./api";
import { useAccount, type AccountUser } from "./useAccount";
import { Empty, Field, Notice, Section, StatusBadge } from "./ui";

function Heading({ title, description }: { title: string; description: string }) {
  return <div className="nx-page-heading"><div><div className="nx-eyebrow">NEXORA ACCOUNT</div><h1>{title}</h1><p>{description}</p></div></div>;
}

export default function AccountExperience() {
  const acc = useAccount();
  if (acc.loading) return <p className="nx-wallet-lede"><LoaderCircle className="nx-spin" size={16}/> Loading…</p>;
  if (!acc.available) return <><Heading title="Account" description="Accounts are used to apply for asset tokenization and to subscribe to approved offerings."/><Notice kind="info">Accounts aren’t available on this deployment yet.</Notice></>;
  if (!acc.user) return <><Heading title="Sign in" description="A NEXORA account lets you apply to tokenize a real-world asset and request subscriptions to approved offerings. It is separate from your wallet: your keys never leave this device."/><AuthForms onDone={acc.reload}/></>;
  return <SignedIn user={acc.user} reload={acc.reload}/>;
}

export function AuthForms({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  return <section className="nx-panel nx-rwa-auth">
    <div className="nx-admin-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : undefined} onClick={() => { setMode("login"); setMsg(null); }}>Sign in</button>
      <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : undefined} onClick={() => { setMode("register"); setMsg(null); }}>Create account</button>
    </div>
    <form className="nx-admin-form" onSubmit={async e => {
      e.preventDefault();
      if (mode === "register" && pw !== pw2) { setMsg({ kind: "error", text: "The passwords don't match." }); return; }
      setBusy(true); setMsg(null);
      const r = await api(mode === "login" ? "/api/account/login" : "/api/account/register", { body: { email, password: pw } });
      setBusy(false);
      if (!r.ok) { setMsg({ kind: "error", text: r.error }); return; }
      if (mode === "login") { setPw(""); onDone(); }
      else { setPw(""); setPw2(""); setMsg({ kind: "success", text: "Check your email for a confirmation link, then enter your password to activate the account." }); }
    }}>
      <Field label="Email"><input className="nx-wallet-input" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required/></Field>
      <Field label="Password" hint={mode === "register" ? "At least 12 characters." : undefined}><input className="nx-wallet-input" type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 12 : 1} maxLength={200}/></Field>
      {mode === "register" && <Field label="Confirm password"><input className="nx-wallet-input" type="password" value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password" required/></Field>}
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <button className="nx-wallet-primary" disabled={busy}>{busy && <LoaderCircle className="nx-spin" size={15}/>}{mode === "login" ? "Sign in" : "Create account"}</button>
    </form>
  </section>;
}

type App = { reference: string; status: string; asset_name: string; updated_at: string };
type Sub = { id: string; investor_address: string; amount: string; status: string; reference: string; asset_name: string; token_code: string | null; issuer_address: string | null; decision_reason: string | null; created_at: string };

function SignedIn({ user, reload }: { user: AccountUser; reload: () => void }) {
  const { address, requestWallet } = useStellarWallet();
  const [apps, setApps] = useState<App[] | null>(null);
  const [subs, setSubs] = useState<Sub[] | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const load = useCallback(async () => {
    const [a, s] = await Promise.all([api<{ applications: App[] }>("/api/rwa/applications"), api<{ subscriptions: Sub[] }>("/api/rwa/subscriptions")]);
    if (a.ok) setApps(a.data.applications);
    if (s.ok) setSubs(s.data.subscriptions);
  }, []);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  const link = async () => {
    const me = address ?? await requestWallet();
    if (!me) return;
    const r = await api("/api/account/me", { method: "PATCH", body: { stellarAddress: me } });
    if (r.ok) { setMsg({ kind: "success", text: "Wallet address linked." }); reload(); } else setMsg({ kind: "error", text: r.error });
  };

  return <>
    <Heading title="Your account" description="Your RWA applications and subscriptions. Transactions are always signed in your own wallet on this device."/>
    {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    <div className="nx-admin-grid-2">
      <Section kicker="PROFILE" title="Account" actions={<button className="nx-rwa-button" onClick={async () => { await api("/api/account/logout", { body: {} }); reload(); }}><LogOut size={13}/> Sign out</button>}>
        <dl className="nx-rwa-facts">
          <div><dt>Email</dt><dd><UserRound size={13}/> {user.email}</dd></div>
          <div><dt>Linked Stellar address</dt><dd>{user.stellarAddress ? <code>{user.stellarAddress}</code> : "Not linked"}</dd></div>
        </dl>
        {(!user.stellarAddress || (address && address !== user.stellarAddress)) && <div className="nx-rwa-actions"><button className="nx-rwa-button primary" onClick={() => void link()}>{address ? "Link this wallet’s address" : "Set up wallet to link"}</button></div>}
        <p className="nx-admin-help">Only your public address is stored with your account. Your secret key never leaves this device.</p>
      </Section>
      <Section kicker="ISSUERS" title="Tokenization applications" actions={<Link className="nx-rwa-button primary" href="/rwa/apply"><Building2 size={13}/> New application</Link>}>
        {!apps ? null : apps.length === 0 ? <Empty>No applications yet.</Empty> : <ul className="nx-rwa-list">{apps.map(a =>
          <li key={a.reference}><Link href={`/rwa/applications/${a.reference}`}><div><strong>{a.asset_name}</strong><small>{a.reference} · updated {fmtDate(a.updated_at)}</small></div><StatusBadge status={a.status}/></Link></li>)}</ul>}
      </Section>
    </div>
    <Section kicker="INVESTORS" title="Subscriptions">
      {!subs ? null : subs.length === 0 ? <Empty>No subscriptions yet. <Link href="/rwa">Browse offerings</Link></Empty> : <ul className="nx-rwa-list">{subs.map(s =>
        <li key={s.id}><SubscriptionRow sub={s} onChange={load}/></li>)}</ul>}
    </Section>
  </>;
}

export function SubscriptionRow({ sub, onChange }: { sub: Sub; onChange: () => void }) {
  const { address, requestWallet, signTransaction } = useStellarWallet();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const trust = async () => {
    if (!sub.token_code || !sub.issuer_address) return;
    setBusy(true); setMsg(null);
    try {
      const me = address ?? await requestWallet();
      if (!me) return;
      if (me !== sub.investor_address) { setMsg({ kind: "error", text: `Use the wallet ${short(sub.investor_address)} named in this request.` }); return; }
      const [account, fee] = await Promise.all([loadAccount(me), loadFeePerOperation()]);
      const plan = buildRwaTrustline(account, sub.token_code, sub.issuer_address, fee);
      const signed = await signTransaction(plan.xdr, plan.intent, { title: `Add ${sub.token_code} trustline` });
      const out = await submitSigned(signed);
      setMsg(out.status === "confirmed" ? { kind: "success", text: "Trustline added. The issuer can now authorise it." } : out.status === "pending" ? { kind: "success", text: "Submitted; confirmation pending." } : { kind: "error", text: out.message });
    } catch (e) {
      if (e instanceof RwaOpError && e.code === "already_trusted") setMsg({ kind: "success", text: "Your wallet already has this trustline." });
      else if (e instanceof TxGuardError) setMsg({ kind: "error", text: guardMessage(e) });
      else if (e instanceof ClientError) setMsg({ kind: "error", text: e.code === "inactive" ? "Fund your wallet with XLM first." : "Network unavailable. Try again shortly." });
    } finally { setBusy(false); }
  };
  return <div className="nx-rwa-sub">
    <div><strong>{fmtAmount(sub.amount)} {sub.token_code ?? ""} · {sub.asset_name}</strong><small><Link href={`/rwa/${sub.reference}`}>{sub.reference}</Link> · wallet {short(sub.investor_address)} · {fmtDate(sub.created_at)}{sub.decision_reason ? ` · ${sub.decision_reason}` : ""}</small></div>
    <div className="nx-rwa-actions">
      <StatusBadge kind="subscription" status={sub.status}/>
      {(sub.status === "requested" || sub.status === "accepted") && <button className="nx-rwa-button" disabled={busy} onClick={() => void trust()}>Add trustline</button>}
      {(sub.status === "requested" || sub.status === "accepted") && <button className="nx-rwa-button" disabled={busy} onClick={async () => {
        const r = await api(`/api/rwa/subscriptions/${sub.id}`, { body: { action: "cancel" } });
        if (r.ok) onChange(); else setMsg({ kind: "error", text: r.error });
      }}>Cancel request</button>}
    </div>
    {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
  </div>;
}

export function VerifyAccount() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <>
    <Heading title="Confirm your email" description="Enter the password you chose when creating your account."/>
    <section className="nx-panel nx-rwa-auth">
      {!token ? <Notice kind="error">This link is incomplete. Open the link from the email again.</Notice> : <form className="nx-admin-form" onSubmit={async e => {
        e.preventDefault();
        setBusy(true); setError("");
        const r = await api("/api/account/verify", { body: { token, password: pw } });
        setBusy(false);
        if (r.ok) router.replace("/account"); else setError(r.error);
      }}>
        <Field label="Password"><input className="nx-wallet-input" type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" required/></Field>
        {error && <Notice kind="error">{error}</Notice>}
        <button className="nx-wallet-primary" disabled={busy}>Confirm email</button>
      </form>}
    </section>
  </>;
}
