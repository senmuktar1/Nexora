"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { Download, LoaderCircle, Rocket, Trash2, Upload } from "lucide-react";
import { useStellarWallet } from "@/components/wallet/WalletProvider";
import { LaunchFlow, type LaunchConfig, type LaunchRecord } from "@/components/nexora/launch/LaunchFlows";
import { ClientError, loadAccount, loadFeePerOperation, submitSigned } from "@/lib/stellar/client";
import { buildAuthorizeTrustline } from "@/lib/stellar/rwa-ops";
import { buildPayment, PaymentError } from "@/lib/stellar/payment";
import { guardMessage, TxGuardError } from "@/lib/stellar/tx-guard";
import {
  ALLOWED_DOCUMENT_TYPES, EVENT_KINDS, ISSUER_EVENT_KINDS, MAX_DOCUMENT_BYTES, REQUIRED_DOCUMENTS, RWA_CATEGORIES, RWA_DOCUMENT_KINDS, RWA_STATUSES,
  RWA_TEXT_FIELDS, TOKEN_TEXT_FIELDS, type EventKind, type RwaDocumentKind
} from "@/lib/rwa";
import { api, fmtAmount, fmtDate, short } from "./api";
import { useAccount } from "./useAccount";
import { AuthForms } from "./AccountExperience";
import { Empty, EvidenceBadge, Facts, Field, Notice, Section, StatusBadge } from "./ui";

type R = Record<string, unknown>;
type View = { application: R; documents: R[]; history: R[]; tokenConfig: R | null; events: R[]; subscriptions: R[]; verification: R[] };
type Msg = { kind: "error" | "success"; text: string; list?: string[] } | null;

export default function IssuerWorkspace({ reference }: { reference: string }) {
  const acc = useAccount();
  const [v, setV] = useState<View | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const r = await api<View>(`/api/rwa/applications/${reference}`);
    if (r.ok) { setV(r.data); setError(""); } else setError(r.error);
  }, [reference]);
  useEffect(() => { if (acc.user) { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); } }, [acc.user, load]);

  if (acc.loading) return null;
  if (!acc.user) return <><div className="nx-page-heading"><div><div className="nx-eyebrow">RWA APPLICATION</div><h1>Sign in to continue</h1></div></div><AuthForms onDone={acc.reload}/></>;
  if (error && !v) return <><Link className="nx-admin-back" href="/account">← Account</Link><Notice kind="error">{error}</Notice></>;
  if (!v) return <p className="nx-wallet-lede"><LoaderCircle className="nx-spin" size={16}/> Loading…</p>;
  const a = v.application;
  const status = String(a.status);
  const editable = status === "draft" || status === "info_requested";

  return <>
    <Link className="nx-admin-back" href="/account">← Account</Link>
    <div className="nx-page-heading"><div><div className="nx-eyebrow">{String(a.reference)}</div><h1>{String(a.asset_name)}</h1>
      <p>{RWA_CATEGORIES[a.category as keyof typeof RWA_CATEGORIES]} · started {fmtDate(a.created_at)}{a.submitted_at ? ` · submitted ${fmtDate(a.submitted_at)}` : ""}</p></div>
      <div className="nx-admin-heading-badges"><StatusBadge status={status}/>{v.tokenConfig && <StatusBadge kind="token" status={String(v.tokenConfig.status)}/>}</div></div>

    {status === "info_requested" && <Notice kind="info"><strong>NEXORA requested more information:</strong> {String(a.info_request)}<br/>Update the application or documents, then submit again.</Notice>}
    {(status === "rejected" || status === "suspended") && a.decision_reason ? <Notice kind="error"><strong>{RWA_STATUSES[status as keyof typeof RWA_STATUSES]}:</strong> {String(a.decision_reason)}</Notice> : null}
    {(status === "submitted" || status === "under_review") && <Notice kind="info">Your application is with NEXORA reviewers. You’ll see their decision here.</Notice>}

    <ApplicationForm v={v} editable={editable} onSaved={load}/>
    <Documents v={v} editable={editable} legalOnly={status === "approved" && !["authorized", "issued"].includes(String(v.tokenConfig?.status ?? ""))} onChange={load}/>
    {editable && <SubmitPanel reference={reference} status={status} onDone={load}/>}
    {v.verification.length > 0 && <Section kicker="REVIEW" title="Verification status">
      <ul className="nx-rwa-verify">{v.verification.map(x => <li key={String(x.subject)}><span>{String(x.label)}</span><EvidenceBadge status={String(x.status)}/></li>)}</ul>
    </Section>}
    {(status === "approved" || status === "suspended") && <TokenSection v={v} reference={reference} onChange={load}/>}
    {v.tokenConfig?.status === "issued" && <Subscriptions v={v} reference={reference} onChange={load}/>}
    {(status === "approved" || status === "suspended") && <Lifecycle v={v} reference={reference} onChange={load}/>}
    <Section kicker="HISTORY" title="Status history">
      <ul className="nx-admin-feed">{v.history.map((h, i) => <li key={i}>
        <strong>{h.from_status ? `${RWA_STATUSES[h.from_status as keyof typeof RWA_STATUSES]} → ` : ""}{RWA_STATUSES[h.to_status as keyof typeof RWA_STATUSES]}</strong>
        {h.reason ? <span>{String(h.reason)}</span> : null}<small>{fmtDate(h.created_at, true)}</small></li>)}</ul>
    </Section>
  </>;
}

/* ───────────── Application fields ───────────── */

function ApplicationForm({ v, editable, onSaved }: { v: View; editable: boolean; onSaved: () => void }) {
  const a = v.application;
  const router = useRouter();
  const { address, requestWallet } = useStellarWallet();
  const initial = useMemo(() => {
    const f: Record<string, string> = { category: String(a.category) };
    for (const [k] of RWA_TEXT_FIELDS) f[k] = String(a[k] ?? "");
    for (const k of ["valuation_amount", "valuation_currency", "valuation_date", "issuer_stellar_address"]) f[k] = a[k] === null || a[k] === undefined ? "" : String(a[k]).slice(0, k === "valuation_date" ? 10 : 200);
    return f;
  }, [a]);
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const set = (k: string, val: string) => setF(x => ({ ...x, [k]: val }));

  if (!editable) return <Section kicker="APPLICATION" title="Asset details">
    <Facts items={[
      ["Valuation", `${fmtAmount(a.valuation_amount, a.valuation_currency)} · ${fmtDate(a.valuation_date)}`],
      ["Issuing & distribution address", <code key="x">{String(a.issuer_stellar_address ?? "—")}</code>],
      ...RWA_TEXT_FIELDS.filter(([k]) => k !== "asset_name").map(([k, label]) => [label, String(a[k] ?? "")] as [string, string])
    ]}/>
  </Section>;

  return <Section kicker="APPLICATION" title="Asset details">
    <form className="nx-admin-form" onSubmit={async e => {
      e.preventDefault();
      setBusy(true); setMsg(null);
      const r = await api(`/api/rwa/applications/${a.reference}`, { method: "PATCH", body: f });
      setBusy(false);
      if (r.ok) { setMsg({ kind: "success", text: "Saved." }); onSaved(); } else setMsg({ kind: "error", text: r.error });
    }}>
      <div className="nx-rwa-grid">
        <Field label="Category"><select className="nx-wallet-input" value={f.category} onChange={e => set("category", e.target.value)}>{Object.entries(RWA_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        {RWA_TEXT_FIELDS.filter(([, , , , multi]) => !multi).map(([k, label, max, req]) => <Field key={k} label={`${label}${req ? "" : " (optional)"}`}>
          <input className="nx-wallet-input" value={f[k]} onChange={e => set(k, e.target.value)} maxLength={max}/></Field>)}
        <Field label="Independent valuation"><input className="nx-wallet-input" inputMode="decimal" value={f.valuation_amount} onChange={e => set("valuation_amount", e.target.value)} placeholder="Amount"/></Field>
        <Field label="Valuation currency"><input className="nx-wallet-input" value={f.valuation_currency} onChange={e => set("valuation_currency", e.target.value.toUpperCase())} maxLength={3} placeholder="USD"/></Field>
        <Field label="Valuation date"><input className="nx-wallet-input" type="date" value={f.valuation_date} onChange={e => set("valuation_date", e.target.value)}/></Field>
        <Field label="Issuing & distribution Stellar address" hint="Your NEXORA wallet address that will issue and distribute the token.">
          <div className="nx-rwa-inline"><input className="nx-wallet-input" value={f.issuer_stellar_address} onChange={e => set("issuer_stellar_address", e.target.value.trim())} maxLength={56} placeholder="G…"/>
            <button type="button" className="nx-rwa-button" onClick={async () => { const me = address ?? await requestWallet(); if (me) set("issuer_stellar_address", me); }}>Use my wallet</button></div>
        </Field>
      </div>
      {RWA_TEXT_FIELDS.filter(([, , , , multi]) => multi).map(([k, label, max, req]) => <Field key={k} label={`${label}${req ? "" : " (optional)"}`}>
        <textarea className="nx-wallet-input" rows={3} value={f[k]} onChange={e => set(k, e.target.value)} maxLength={max}/></Field>)}
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="nx-rwa-actions">
        <button className="nx-rwa-button primary" disabled={busy}>Save</button>
        {a.status === "draft" && !a.submitted_at && <button type="button" className="nx-rwa-button danger" disabled={busy} onClick={async () => {
          const r = await api(`/api/rwa/applications/${a.reference}`, { method: "DELETE" });
          if (r.ok) router.push("/account"); else setMsg({ kind: "error", text: r.error });
        }}><Trash2 size={13}/> Delete draft</button>}
      </div>
    </form>
  </Section>;
}

/* ───────────── Documents ───────────── */

function Documents({ v, editable, legalOnly, onChange }: { v: View; editable: boolean; legalOnly: boolean; onChange: () => void }) {
  const ref = String(v.application.reference);
  const [kind, setKind] = useState<RwaDocumentKind>(editable ? "ownership" : "legal_opinion");
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const have = new Set(v.documents.map(d => d.kind));
  return <Section kicker="EVIDENCE" title="Supporting documents">
    <p className="nx-admin-help">Required: {REQUIRED_DOCUMENTS.map(k => `${RWA_DOCUMENT_KINDS[k]}${have.has(k) ? " ✓" : ""}`).join(" · ")}. PDF, PNG or JPEG up to 4 MB. Files are encrypted and visible only to you and NEXORA reviewers unless reviewers publish them with an approved offering.</p>
    {v.documents.length === 0 ? <Empty>No documents uploaded.</Empty> : <ul className="nx-rwa-docs">{v.documents.map(d => <li key={String(d.id)}>
      <div><strong>{RWA_DOCUMENT_KINDS[d.kind as RwaDocumentKind]}</strong><small>{String(d.filename)} · {Math.ceil(Number(d.size_bytes) / 1024)} KB · {fmtDate(d.created_at)}{d.public_with_offering ? " · published with offering" : ""}</small></div>
      <div className="nx-rwa-doc-actions">
        <a className="nx-rwa-button" href={`/api/rwa/documents/${d.id}`} download><Download size={13}/> Download</a>
        {editable && <button className="nx-rwa-button" aria-label={`Remove ${String(d.filename)}`} onClick={async () => {
          const r = await api(`/api/rwa/applications/${ref}/documents/${d.id}`, { method: "DELETE" });
          if (r.ok) onChange(); else setMsg({ kind: "error", text: r.error });
        }}><Trash2 size={13}/> Remove</button>}
      </div>
    </li>)}</ul>}
    {!editable && legalOnly && <p className="nx-admin-help">Before NEXORA can authorise issuance, upload your counsel’s legal opinion or the regulator’s clearance for this offering. A typed reference isn’t accepted on its own.</p>}
    {(editable || legalOnly) && <form className="nx-admin-form nx-rwa-upload" onSubmit={async e => {
      e.preventDefault();
      if (!file) return;
      if (file.size > MAX_DOCUMENT_BYTES) { setMsg({ kind: "error", text: "Files must be 4 MB or smaller." }); return; }
      const form = new FormData(); form.set("kind", kind); form.set("file", file);
      setBusy(true); setMsg(null);
      const r = await api(`/api/rwa/applications/${ref}/documents`, { form });
      setBusy(false);
      if (r.ok) { setFile(null); setInputKey(k => k + 1); setMsg({ kind: "success", text: "Uploaded." }); onChange(); } else setMsg({ kind: "error", text: r.error });
    }}>
      <div className="nx-rwa-grid">
        <Field label="Document type"><select className="nx-wallet-input" value={kind} onChange={e => setKind(e.target.value as RwaDocumentKind)}>{Object.entries(RWA_DOCUMENT_KINDS).filter(([k]) => k !== "report" && (editable || k === "legal_opinion")).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="File"><input key={inputKey} type="file" aria-label="Choose document" accept={Object.keys(ALLOWED_DOCUMENT_TYPES).join(",")} onChange={e => setFile(e.target.files?.[0] ?? null)}/></Field>
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="nx-rwa-actions"><button className="nx-rwa-button primary" disabled={busy || !file}>{busy ? <LoaderCircle className="nx-spin" size={13}/> : <Upload size={13}/>} Upload</button></div>
    </form>}
  </Section>;
}

function SubmitPanel({ reference, status, onDone }: { reference: string; status: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  return <section className="nx-panel nx-rwa-section nx-rwa-submit">
    <div><strong>{status === "info_requested" ? "Submit the requested information" : "Submit for review"}</strong><p className="nx-admin-help">Save your changes first. After submitting you can’t edit until reviewers ask for more information.</p></div>
    <button className="nx-wallet-primary" disabled={busy} onClick={async () => {
      setBusy(true); setMsg(null);
      const r = await api<{ problems?: string[] }>(`/api/rwa/applications/${reference}/submit`, { body: {} });
      setBusy(false);
      if (r.ok) onDone(); else setMsg({ kind: "error", text: r.error, list: r.data.problems as string[] | undefined });
    }}>Submit application</button>
    {msg && <Notice kind={msg.kind}>{msg.text}{msg.list && <ul>{msg.list.map(p => <li key={p}>{p}</li>)}</ul>}</Notice>}
  </section>;
}

/* ───────────── Token configuration & issuance ───────────── */

function TokenSection({ v, reference, onChange }: { v: View; reference: string; onChange: () => void }) {
  const cfg = v.tokenConfig;
  const a = v.application;
  const status = cfg ? String(cfg.status) : "none";
  const editable = a.status === "approved" && (status === "none" || status === "draft" || status === "revoked");
  const { address, requestWallet } = useStellarWallet();
  const [f, setF] = useState<Record<string, string | boolean>>(() => ({
    token_code: String(cfg?.token_code ?? ""), total_supply: String(cfg?.total_supply ?? ""), price_amount: String(cfg?.price_amount ?? ""),
    price_currency: String(cfg?.price_currency ?? "USD"), min_investment: String(cfg?.min_investment ?? ""),
    ...Object.fromEntries(TOKEN_TEXT_FIELDS.map(([k]) => [k, String(cfg?.[k] ?? (k === "investor_eligibility" || k === "transfer_restrictions" ? a[k] ?? "" : ""))])),
    distributor_address: String(cfg?.distributor_address ?? a.issuer_stellar_address ?? ""), clawback_enabled: cfg ? cfg.clawback_enabled !== false : true
  }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [launch, setLaunch] = useState(false);
  const [hash, setHash] = useState("");

  const record = useCallback(async (txHash: string) => {
    setMsg(null);
    const r = await api<{ issuer: string }>(`/api/rwa/applications/${reference}/issuance`, { body: { txHash } });
    if (r.ok) { setMsg({ kind: "success", text: "Issuance verified on Stellar and recorded." }); onChange(); }
    else setMsg({ kind: "error", text: r.error });
  }, [reference, onChange]);
  const onConfirmed = useCallback((rec: LaunchRecord) => { void record(rec.txHash); }, [record]);
  const closeLaunch = useCallback(() => setLaunch(false), []);
  const launchConfig = useMemo<LaunchConfig | null>(() => cfg ? {
    code: String(cfg.token_code), name: String(a.asset_name), description: String(a.description ?? ""), totalSupply: String(cfg.total_supply), homeDomain: "",
    authRequired: true, authRevocable: true, clawback: cfg.clawback_enabled === true, fixedSupply: false, allocations: [], listing: null, rwa: null
  } : null, [cfg, a]);

  return <Section kicker="TOKENIZATION" title="Token configuration">
    {status === "submitted" && <Notice kind="info">Submitted. NEXORA performs a separate final authorization before the token can be issued.</Notice>}
    {status === "revoked" && <Notice kind="error">The authorization was revoked. Review the configuration and submit again.</Notice>}
    {editable ? <form className="nx-admin-form" onSubmit={async e => {
      e.preventDefault();
      setBusy(true); setMsg(null);
      const r = await api(`/api/rwa/applications/${reference}/token-config`, { method: "PUT", body: f });
      setBusy(false);
      if (r.ok) { setMsg({ kind: "success", text: "Configuration saved." }); onChange(); } else setMsg({ kind: "error", text: r.error });
    }}>
      <div className="nx-rwa-grid">
        <Field label="Token code" hint="1–12 letters or digits"><input className="nx-wallet-input" value={String(f.token_code)} onChange={e => setF({ ...f, token_code: e.target.value.toUpperCase() })} maxLength={12} required/></Field>
        <Field label="Total supply"><input className="nx-wallet-input" inputMode="decimal" value={String(f.total_supply)} onChange={e => setF({ ...f, total_supply: e.target.value })} required/></Field>
        <Field label="Price per token"><input className="nx-wallet-input" inputMode="decimal" value={String(f.price_amount)} onChange={e => setF({ ...f, price_amount: e.target.value })} required/></Field>
        <Field label="Price currency"><input className="nx-wallet-input" value={String(f.price_currency)} onChange={e => setF({ ...f, price_currency: e.target.value.toUpperCase() })} maxLength={12} required/></Field>
        <Field label="Minimum investment (tokens)"><input className="nx-wallet-input" inputMode="decimal" value={String(f.min_investment)} onChange={e => setF({ ...f, min_investment: e.target.value })} required/></Field>
        <Field label="Distribution address" hint="Must match the issuing address in your application."><input className="nx-wallet-input" value={String(f.distributor_address)} onChange={e => setF({ ...f, distributor_address: e.target.value.trim() })} maxLength={56} required/></Field>
      </div>
      {TOKEN_TEXT_FIELDS.map(([k, label, max]) => <Field key={k} label={label}><textarea className="nx-wallet-input" rows={2} value={String(f[k])} onChange={e => setF({ ...f, [k]: e.target.value })} maxLength={max} required minLength={10}/></Field>)}
      <label className="nx-wallet-check"><input type="checkbox" checked={f.clawback_enabled === true} onChange={e => setF({ ...f, clawback_enabled: e.target.checked })}/>Enable clawback (lets the issuer recover tokens, e.g. under a court order)</label>
      <p className="nx-admin-help">Every holder must be approved by you on-chain (authorization required and revocable). Tokens can’t be listed on the open DEX at issuance.</p>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="nx-rwa-actions">
        <button className="nx-rwa-button" disabled={busy}>Save configuration</button>
        {(status === "draft" || status === "revoked") && <button type="button" className="nx-rwa-button primary" disabled={busy} onClick={async () => {
          setBusy(true); setMsg(null);
          const r = await api(`/api/rwa/applications/${reference}/token-config`, { body: { action: "submit" } });
          setBusy(false);
          if (r.ok) onChange(); else setMsg({ kind: "error", text: r.error });
        }}>Submit for authorization</button>}
      </div>
    </form> : cfg && <Facts items={[
      ["Token", `${cfg.token_code} · supply ${fmtAmount(cfg.total_supply)}`], ["Price", fmtAmount(cfg.price_amount, cfg.price_currency)],
      ["Minimum investment", `${fmtAmount(cfg.min_investment)} tokens`], ["Distribution address", <code key="d">{String(cfg.distributor_address)}</code>],
      ...(cfg.authorization_expires_at && status === "authorized" ? [["Authorization valid until", fmtDate(cfg.authorization_expires_at, true)] as [string, string]] : []),
      ...(cfg.issuer_address ? [["Issuer account", <code key="i">{String(cfg.issuer_address)}</code>] as [string, React.ReactNode], ["Issuance", <Link key="t" href={`/receipt/${cfg.issued_tx_hash}`}>receipt</Link>] as [string, React.ReactNode]] : [])
    ]}/>}

    {status === "authorized" && a.status === "approved" && <div className="nx-rwa-issue">
      <p className="nx-admin-help">NEXORA has authorised issuance. Issuing creates a new issuer account and sends the full supply to your distribution address in one Mainnet transaction, signed in your wallet after you review it. It costs about 2 XLM in reserves and fees.</p>
      {address && address !== cfg?.distributor_address && <Notice kind="error">Your unlocked wallet ({short(address)}) isn’t the authorised distribution address ({short(cfg?.distributor_address)}).</Notice>}
      <div className="nx-rwa-actions">
        <button className="nx-wallet-primary" onClick={async () => {
          const me = address ?? await requestWallet();
          if (me && me === cfg?.distributor_address) setLaunch(true);
          else if (me) setMsg({ kind: "error", text: "Use the wallet whose address is the authorised distribution address." });
        }}><Rocket size={15}/> Issue {String(cfg?.token_code)} on Stellar</button>
      </div>
      <form className="nx-admin-form" onSubmit={e => { e.preventDefault(); void record(hash.trim()); }}>
        <Field label="Already issued? Record it by transaction hash"><div className="nx-rwa-inline"><input className="nx-wallet-input" value={hash} onChange={e => setHash(e.target.value)} placeholder="64-character hash" maxLength={64}/><button className="nx-rwa-button">Verify & record</button></div></Field>
      </form>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    </div>}
    {launch && launchConfig && <LaunchFlow config={launchConfig} onClose={closeLaunch} onConfirmed={onConfirmed}/>}
  </Section>;
}

/* ───────────── Subscriptions (issuer side) ───────────── */

function Subscriptions({ v, reference, onChange }: { v: View; reference: string; onChange: () => void }) {
  const cfg = v.tokenConfig!;
  const { address, requestWallet, signTransaction, loadRecords } = useStellarWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [reject, setReject] = useState<{ id: string; reason: string } | null>(null);
  const active = v.application.status === "approved";
  const code = String(cfg.token_code), issuer = String(cfg.issuer_address), dist = String(cfg.distributor_address);

  const post = async (id: string, body: R) => {
    const r = await api(`/api/rwa/applications/${reference}/subscriptions/${id}`, { body });
    if (r.ok) { onChange(); return true; }
    setMsg({ kind: "error", text: r.error });
    return false;
  };

  const onChain = async (s: R, step: "authorize" | "deliver") => {
    setBusy(String(s.id)); setMsg(null);
    try {
      const me = address ?? await requestWallet();
      if (!me) return;
      if (me !== dist) { setMsg({ kind: "error", text: `Use the distribution wallet ${short(dist)}.` }); return; }
      const [account, fee] = await Promise.all([loadAccount(me), loadFeePerOperation()]);
      let envelope: string;
      if (step === "authorize") {
        const records = await loadRecords<LaunchRecord>("launch:");
        const secret = records.map(r => r.value).find(r => r.issuer === issuer)?.issuerSecret;
        if (!secret) { setMsg({ kind: "error", text: "The issuer key for this token isn’t saved in this wallet. Import the wallet that issued it." }); return; }
        const plan = buildAuthorizeTrustline(account, code, issuer, String(s.investor_address), fee);
        const signed = await signTransaction(plan.xdr, plan.intent, { title: `Authorise ${short(s.investor_address)} to hold ${code}` });
        const tx = TransactionBuilder.fromXDR(signed, Networks.PUBLIC);
        tx.sign(Keypair.fromSecret(secret));
        envelope = tx.toEnvelope().toXDR("base64");
      } else {
        const recipient = await loadAccount(String(s.investor_address)).catch(() => null);
        const plan = buildPayment({ sender: account, recipient, recipientId: String(s.investor_address), asset: `${code}:${issuer}`, amount: String(s.amount), feePerOperation: fee });
        envelope = await signTransaction(plan.xdr, plan.intent, { title: `Deliver ${fmtAmount(s.amount)} ${code}` });
      }
      const out = await submitSigned(envelope);
      if (out.status === "failed") { setMsg({ kind: "error", text: out.message }); return; }
      if (out.status === "pending") { setMsg({ kind: "success", text: "Submitted; confirmation pending. Record it again once it confirms." }); return; }
      if (await post(String(s.id), { action: step === "authorize" ? "authorized" : "delivered", txHash: out.hash })) setMsg({ kind: "success", text: step === "authorize" ? "Trustline authorised and verified." : "Delivery verified on Stellar." });
    } catch (e) {
      if (e instanceof TxGuardError) setMsg({ kind: "error", text: guardMessage(e) });
      else if (e instanceof PaymentError) setMsg({ kind: "error", text: e.code === "no_trustline" ? "The investor hasn’t added the trustline yet." : e.code === "insufficient_balance" ? "Not enough tokens or XLM in the distribution wallet." : "Check the payment details." });
      else if (e instanceof ClientError) setMsg({ kind: "error", text: e.code === "inactive" ? "The account isn’t active on Stellar yet." : "Network unavailable. Try again shortly." });
      else if (e instanceof Error && /op_no_trust|trustline/i.test(e.message)) setMsg({ kind: "error", text: "The investor hasn’t added the trustline yet." });
    } finally { setBusy(null); }
  };

  return <Section kicker="INVESTORS" title="Subscription requests">
    <p className="nx-admin-help">Accept a request, wait for the investor to add the trustline, authorise it, then deliver the tokens. Each on-chain step is signed in your wallet and verified by NEXORA. Settle payment with the investor under your offering terms.</p>
    {v.subscriptions.length === 0 ? <Empty>No requests yet.</Empty> : <ul className="nx-rwa-list">{v.subscriptions.map(s => <li key={String(s.id)} className="nx-rwa-sub">
      <div><strong>{fmtAmount(s.amount)} {code} · {String(s.investor_email)}</strong><small>wallet {short(s.investor_address)} · {fmtDate(s.created_at)}{s.decision_reason ? ` · ${s.decision_reason}` : ""}</small></div>
      <div className="nx-rwa-actions"><StatusBadge kind="subscription" status={String(s.status)}/>
        {active && s.status === "requested" && <button className="nx-rwa-button primary" disabled={!!busy} onClick={() => void post(String(s.id), { action: "accept" })}>Accept</button>}
        {active && s.status === "accepted" && <button className="nx-rwa-button primary" disabled={!!busy} onClick={() => void onChain(s, "authorize")}>{busy === s.id ? <LoaderCircle className="nx-spin" size={13}/> : null}Authorise trustline</button>}
        {active && s.status === "authorized" && <button className="nx-rwa-button primary" disabled={!!busy} onClick={() => void onChain(s, "deliver")}>{busy === s.id ? <LoaderCircle className="nx-spin" size={13}/> : null}Deliver tokens</button>}
        {(s.status === "requested" || s.status === "accepted") && <button className="nx-rwa-button" disabled={!!busy} onClick={() => setReject({ id: String(s.id), reason: "" })}>Decline</button>}
      </div>
      {reject && reject.id === s.id && <form className="nx-admin-form" onSubmit={async e => { e.preventDefault(); if (await post(reject.id, { action: "reject", reason: reject.reason })) setReject(null); }}>
        <Field label="Reason (shown to the investor)"><input className="nx-wallet-input" value={reject.reason} onChange={e => setReject({ id: reject.id, reason: e.target.value })} required minLength={3}/></Field>
        <div className="nx-rwa-actions"><button className="nx-rwa-button danger">Decline request</button><button type="button" className="nx-rwa-button" onClick={() => setReject(null)}>Cancel</button></div>
      </form>}
    </li>)}</ul>}
    {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
  </Section>;
}

/* ───────────── Lifecycle reporting ───────────── */

function Lifecycle({ v, reference, onChange }: { v: View; reference: string; onChange: () => void }) {
  const [kind, setKind] = useState<EventKind>("valuation_update");
  const [f, setF] = useState({ title: "", body: "", amount: "", currency: "", event_date: "", tx_hash: "" });
  const [share, setShare] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  return <Section kicker="LIFECYCLE" title="Reporting & investor requests">
    <form className="nx-admin-form" onSubmit={async e => {
      e.preventDefault();
      const form = new FormData();
      form.set("kind", kind); form.set("public", String(share));
      for (const [k, val] of Object.entries(f)) if (val) form.set(k, val);
      if (file) form.set("file", file);
      setBusy(true); setMsg(null);
      const r = await api(`/api/rwa/applications/${reference}/events`, { form });
      setBusy(false);
      if (r.ok) { setF({ title: "", body: "", amount: "", currency: "", event_date: "", tx_hash: "" }); setFile(null); setInputKey(k => k + 1); setMsg({ kind: "success", text: "Report filed." }); onChange(); }
      else setMsg({ kind: "error", text: r.error });
    }}>
      <div className="nx-rwa-grid">
        <Field label="Report type"><select className="nx-wallet-input" value={kind} onChange={e => setKind(e.target.value as EventKind)}>{ISSUER_EVENT_KINDS.map(k => <option key={k} value={k}>{EVENT_KINDS[k]}</option>)}</select></Field>
        <Field label="Title"><input className="nx-wallet-input" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} required minLength={3} maxLength={160}/></Field>
        <Field label="Amount (optional)"><input className="nx-wallet-input" inputMode="decimal" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })}/></Field>
        <Field label="Currency (optional)"><input className="nx-wallet-input" value={f.currency} onChange={e => setF({ ...f, currency: e.target.value.toUpperCase() })} maxLength={12}/></Field>
        <Field label="Date (optional)"><input className="nx-wallet-input" type="date" value={f.event_date} onChange={e => setF({ ...f, event_date: e.target.value })}/></Field>
        <Field label="Related Stellar transaction (optional)"><input className="nx-wallet-input" value={f.tx_hash} onChange={e => setF({ ...f, tx_hash: e.target.value.trim() })} maxLength={64}/></Field>
      </div>
      <Field label="Details"><textarea className="nx-wallet-input" rows={2} value={f.body} onChange={e => setF({ ...f, body: e.target.value })} maxLength={4000}/></Field>
      <Field label="Supporting file (optional)"><input key={inputKey} type="file" aria-label="Choose report file" accept={Object.keys(ALLOWED_DOCUMENT_TYPES).join(",")} onChange={e => setFile(e.target.files?.[0] ?? null)}/></Field>
      <label className="nx-wallet-check"><input type="checkbox" checked={share} onChange={e => setShare(e.target.checked)}/>Show on the public offering page</label>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="nx-rwa-actions"><button className="nx-rwa-button primary" disabled={busy}>File report</button></div>
    </form>
    {v.events.length === 0 ? <Empty>No records yet.</Empty> : <ul className="nx-admin-feed">{v.events.map(ev => <li key={String(ev.id)}>
      <strong>{EVENT_KINDS[ev.kind as EventKind]} · {String(ev.title)} <StatusBadge kind="other" status={String(ev.status)}/></strong>
      {ev.body ? <span>{String(ev.body)}</span> : null}
      <small>{ev.source === "investor" ? "Investor" : ev.source === "admin" ? "NEXORA" : ev.source === "on_chain" ? "On-chain" : "You"}{ev.amount ? ` · ${fmtAmount(ev.amount, ev.currency)}` : ""} · {fmtDate(ev.created_at, true)} · {ev.public ? "public" : "private"}</small>
      {ev.kind === "redemption_request" && (ev.status === "pending_review" || ev.status === "acknowledged") && <div className="nx-rwa-actions">
        {(["acknowledged", "resolved", "rejected"] as const).filter(s => s !== ev.status).map(s => <button key={s} className="nx-rwa-button" onClick={async () => {
          const r = await api(`/api/rwa/applications/${reference}/events`, { method: "PATCH", body: { eventId: ev.id, status: s } });
          if (r.ok) onChange(); else setMsg({ kind: "error", text: r.error });
        }}>{s === "acknowledged" ? "Acknowledge" : s === "resolved" ? "Mark redeemed" : "Decline"}</button>)}
      </div>}
    </li>)}</ul>}
  </Section>;
}
