"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Download, ExternalLink, LoaderCircle } from "lucide-react";
import { api, fmtAmount, fmtDate } from "@/components/rwa/api";
import { Empty, EvidenceBadge, Facts, Field, Notice, Section, StatusBadge } from "@/components/rwa/ui";
import {
  EVENT_KINDS, EVIDENCE_STATUS, FINDING_SUBJECTS, RWA_CATEGORIES, RWA_DOCUMENT_KINDS, RWA_STATUSES, RWA_TEXT_FIELDS, TOKEN_TEXT_FIELDS,
  type EventKind, type RwaCategory, type RwaDocumentKind
} from "@/lib/rwa";
import { useAdmin } from "./AdminShell";
import { AdminHeading } from "./AdminOverview";

type R = Record<string, unknown>;
type Detail = {
  application: R; documents: R[]; history: R[]; tokenConfig: R | null; events: R[]; subscriptions: R[]; verification: R[];
  owner: R | null; findings: R[]; tokenAuthorization: R | null; checklist: { key: string; label: string; ok: boolean }[];
  settings: { requireClawback: boolean; authorizationValidityDays: number };
  legalClearanceDocuments: { id: string; filename: string; verified_at: string }[];
};

const ACTIONS: { action: string; label: string; from: string[]; perm: string; reason: string | null; danger?: boolean }[] = [
  { action: "start_review", label: "Start review", from: ["submitted"], perm: "applications.review", reason: null },
  { action: "request_info", label: "Request information", from: ["submitted", "under_review"], perm: "applications.review", reason: "What does the applicant need to provide?" },
  { action: "approve", label: "Approve", from: ["under_review"], perm: "applications.decide", reason: "Reason for approval (recorded)" },
  { action: "reject", label: "Reject", from: ["submitted", "under_review", "info_requested"], perm: "applications.decide", reason: "Reason for rejection (shown to the applicant)", danger: true },
  { action: "suspend", label: "Suspend", from: ["approved"], perm: "applications.decide", reason: "Reason for suspension (shown to the applicant)", danger: true },
  { action: "reinstate", label: "Reinstate", from: ["suspended"], perm: "applications.decide", reason: "Reason for reinstatement" }
];

export default function AdminApplicationDetail() {
  const { ref } = useParams<{ ref: string }>();
  const { permissions } = useAdmin();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const r = await api<Detail>(`/api/admin/applications/${ref}`);
    if (r.ok) { setD(r.data); setError(""); } else setError(r.error);
  }, [ref]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  if (error && !d) return <><BackLink/><Notice kind="error">{error}</Notice></>;
  if (!d) return <p className="nx-wallet-lede"><LoaderCircle className="nx-spin" size={16}/> Loading…</p>;
  const a = d.application;
  const can = (p: string) => permissions.includes(p);
  const docName = (id: unknown) => d.documents.find(x => x.id === id)?.filename as string | undefined;

  return <>
    <BackLink/>
    <AdminHeading kicker={String(a.reference)} title={String(a.asset_name)}>
      <div className="nx-admin-heading-badges"><StatusBadge status={String(a.status)}/>{d.tokenConfig && <StatusBadge kind="token" status={String(d.tokenConfig.status)}/>}{a.published ? <StatusBadge status="approved" label="Listed"/> : null}</div>
    </AdminHeading>

    <nav className="nx-admin-anchors" aria-label="Sections">
      {[["decision", "Decision"], ["application", "Application"], ["documents", "Documents"], ["findings", "Findings"], ["tokenization", "Tokenization"], ["lifecycle", "Lifecycle"], ["subscriptions", "Subscriptions"], ["history", "History"]]
        .map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
    </nav>

    <Section id="decision" kicker="REVIEW" title="Decision">
      <DecisionPanel status={String(a.status)} reference={String(a.reference)} can={can} onDone={load}/>
      {a.info_request ? <Facts items={[["Open information request", String(a.info_request)]]}/> : null}
      {a.decision_reason ? <Facts items={[["Last decision reason", String(a.decision_reason)]]}/> : null}
    </Section>

    <div className="nx-admin-grid-2">
      <Section id="application" kicker="ISSUER DECLARATIONS" title="Application">
        <p className="nx-admin-help">Everything in this section is declared by the applicant. Record what you verify under Findings.</p>
        <Facts items={[
          ["Category", RWA_CATEGORIES[a.category as RwaCategory]],
          ["Submitted", fmtDate(a.submitted_at, true)],
          ["Applicant account", `${d.owner?.email ?? "—"}${d.owner?.status === "suspended" ? " (suspended)" : ""}`],
          ["Valuation", `${fmtAmount(a.valuation_amount, a.valuation_currency)} · ${fmtDate(a.valuation_date)}`],
          ["Issuer Stellar address", <code key="addr">{String(a.issuer_stellar_address ?? "—")}</code>],
          ...RWA_TEXT_FIELDS.filter(([k]) => k !== "asset_name").map(([k, label]) => [label, String(a[k] ?? "")] as [string, string])
        ]}/>
      </Section>
      <div>
        <Section id="documents" kicker="EVIDENCE" title="Documents">
          {d.documents.length === 0 ? <Empty>No documents.</Empty> : <ul className="nx-rwa-docs">{d.documents.map(doc =>
            <li key={String(doc.id)}>
              <div><strong>{RWA_DOCUMENT_KINDS[doc.kind as RwaDocumentKind]}</strong><small>{String(doc.filename)} · {Math.ceil(Number(doc.size_bytes) / 1024)} KB · SHA-256 {String(doc.sha256).slice(0, 12)}…</small></div>
              <div className="nx-rwa-doc-actions">
                {can("documents.read") && <a className="nx-rwa-button" href={`/api/admin/documents/${doc.id}`} download><Download size={13}/> Download</a>}
                {can("assets.manage") && <DocVisibility reference={String(a.reference)} doc={doc} onDone={load}/>}
              </div>
            </li>)}</ul>}
        </Section>
        <Section kicker="SUMMARY" title="Verification status">
          {d.verification.length === 0 ? <Empty>No findings recorded yet.</Empty> : <ul className="nx-rwa-verify">{d.verification.map(v =>
            <li key={String(v.subject)}><span>{String(v.label)}</span><EvidenceBadge status={String(v.status)}/></li>)}</ul>}
        </Section>
      </div>
    </div>

    <Section id="findings" kicker="REVIEW RECORD" title="Findings & internal notes">
      {can("findings.write") && !["draft"].includes(String(a.status)) && <FindingForm reference={String(a.reference)} documents={d.documents} onDone={load}/>}
      {d.findings.length === 0 ? <Empty>Nothing recorded yet.</Empty> : <ul className="nx-admin-feed">{d.findings.map(f =>
        <li key={String(f.id)}>
          <strong>{f.kind === "note" ? "Internal note" : FINDING_SUBJECTS[f.subject as keyof typeof FINDING_SUBJECTS]} {f.evidence_status ? <EvidenceBadge status={String(f.evidence_status)}/> : null}</strong>
          <span>{String(f.body)}</span>
          <small>{String(f.author_email)} · {fmtDate(f.created_at, true)}{f.document_id ? ` · evidence: ${docName(f.document_id) ?? "document"}` : ""}</small>
        </li>)}</ul>}
    </Section>

    <Section id="tokenization" kicker="SEPARATE FINAL AUTHORIZATION" title="Tokenization">
      <Tokenization d={d} can={can} onDone={load}/>
    </Section>

    <Section id="lifecycle" kicker="ASSET LIFECYCLE" title="Records & events">
      {can("lifecycle.manage") && (a.status === "approved" || a.status === "suspended") && <AdminEventForm reference={String(a.reference)} onDone={load}/>}
      <EventList events={d.events} reference={String(a.reference)} canManage={can("lifecycle.manage")} onDone={load}/>
    </Section>

    <Section id="subscriptions" kicker="INVESTORS" title="Subscriptions">
      {d.subscriptions.length === 0 ? <Empty>No subscription requests.</Empty> : <div className="nx-admin-table">
        <div className="nx-admin-tr nx-admin-th nx-admin-tr-4"><span>Investor</span><span>Amount</span><span>Status</span><span>On-chain</span></div>
        {d.subscriptions.map(s => <div key={String(s.id)} className="nx-admin-tr nx-admin-tr-4">
          <span>{String(s.investor_email)}<small><code>{String(s.investor_address)}</code></small></span>
          <span>{fmtAmount(s.amount)}</span><span><StatusBadge kind="subscription" status={String(s.status)}/></span>
          <span>{s.authorize_tx_hash ? <Link href={`/receipt/${s.authorize_tx_hash}`}>authorisation</Link> : "—"} {s.delivery_tx_hash ? <Link href={`/receipt/${s.delivery_tx_hash}`}>delivery</Link> : null}</span>
        </div>)}
      </div>}
    </Section>

    <Section id="history" kicker="STATUS HISTORY" title="Decisions">
      <ul className="nx-admin-feed">{d.history.map((h, i) => <li key={i}>
        <strong>{h.from_status ? `${RWA_STATUSES[h.from_status as keyof typeof RWA_STATUSES]} → ` : ""}{RWA_STATUSES[h.to_status as keyof typeof RWA_STATUSES]}</strong>
        {h.reason ? <span>{String(h.reason)}</span> : null}
        <small>{h.actor_realm === "admin" ? `Admin ${h.actor_email}` : `Applicant ${h.actor_email ?? ""}`} · {fmtDate(h.created_at, true)}</small>
      </li>)}</ul>
    </Section>
  </>;
}

function BackLink() {
  return <Link className="nx-admin-back" href="/admin/applications"><ArrowLeft size={14}/> Applications</Link>;
}

function DecisionPanel({ status, reference, can, onDone }: { status: string; reference: string; can: (p: string) => boolean; onDone: () => void }) {
  const available = ACTIONS.filter(x => x.from.includes(status) && can(x.perm));
  const [active, setActive] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  if (!available.length) return <p className="nx-admin-help">No decisions are available in the current status{status === "approved" ? " other than suspension rights you don't have" : ""}.</p>;
  const current = ACTIONS.find(x => x.action === active);
  const submit = async (action: string, r: string) => {
    setBusy(true); setMsg(null);
    const res = await api(`/api/admin/applications/${reference}/status`, { body: { action, reason: r } });
    setBusy(false);
    if (res.ok) { setActive(null); setReason(""); setMsg({ kind: "success", text: "Decision recorded." }); onDone(); } else setMsg({ kind: "error", text: res.error });
  };
  return <div className="nx-admin-decision">
    <div className="nx-rwa-actions">{available.map(x => <button key={x.action} type="button" disabled={busy}
      className={x.danger ? "nx-rwa-button danger" : active === x.action ? "nx-rwa-button primary" : "nx-rwa-button"}
      onClick={() => x.reason ? setActive(x.action) : void submit(x.action, "")}>{x.label}</button>)}</div>
    {current?.reason && <form className="nx-admin-form" onSubmit={e => { e.preventDefault(); void submit(current.action, reason); }}>
      <Field label={current.reason}><textarea className="nx-wallet-input" rows={3} value={reason} onChange={e => setReason(e.target.value)} required minLength={5} maxLength={4000}/></Field>
      <div className="nx-rwa-actions"><button className={current.danger ? "nx-rwa-button danger" : "nx-rwa-button primary"} disabled={busy}>Confirm: {current.label}</button><button type="button" className="nx-rwa-button" onClick={() => setActive(null)}>Cancel</button></div>
    </form>}
    {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
  </div>;
}

function DocVisibility({ reference, doc, onDone }: { reference: string; doc: R; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <>
    <label className="nx-wallet-check nx-admin-inline-check"><input type="checkbox" checked={!!doc.public_with_offering} disabled={busy} onChange={async e => {
      setBusy(true); setError("");
      const r = await api(`/api/admin/applications/${reference}/documents/${doc.id}`, { method: "PATCH", body: { public: e.target.checked } });
      setBusy(false);
      if (r.ok) onDone(); else setError(r.error);
    }}/>Publish with offering</label>
    {error && <Notice kind="error">{error}</Notice>}
  </>;
}

function FindingForm({ reference, documents, onDone }: { reference: string; documents: R[]; onDone: () => void }) {
  const [kind, setKind] = useState<"finding" | "note">("finding");
  const [subject, setSubject] = useState("issuer");
  const [evidence, setEvidence] = useState("verified");
  const [doc, setDoc] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  return <form className="nx-admin-form nx-admin-finding" onSubmit={async e => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await api(`/api/admin/applications/${reference}/findings`, { body: kind === "note" ? { kind, body } : { kind, subject, evidenceStatus: evidence, documentId: doc || undefined, body } });
    setBusy(false);
    if (r.ok) { setBody(""); setMsg({ kind: "success", text: kind === "note" ? "Note added." : "Finding recorded." }); onDone(); } else setMsg({ kind: "error", text: r.error });
  }}>
    <div className="nx-admin-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={kind === "finding"} className={kind === "finding" ? "active" : undefined} onClick={() => setKind("finding")}>Verification finding</button>
      <button type="button" role="tab" aria-selected={kind === "note"} className={kind === "note" ? "active" : undefined} onClick={() => setKind("note")}>Internal note</button>
    </div>
    {kind === "finding" && <div className="nx-rwa-grid">
      <Field label="Subject"><select className="nx-wallet-input" value={subject} onChange={e => setSubject(e.target.value)}>{Object.entries(FINDING_SUBJECTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Evidence status"><select className="nx-wallet-input" value={evidence} onChange={e => setEvidence(e.target.value)}>{Object.entries(EVIDENCE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Evidence document" hint={evidence === "verified" ? "Required for a verified finding." : undefined}><select className="nx-wallet-input" value={doc} onChange={e => setDoc(e.target.value)}>
        <option value="">— none —</option>{documents.map(x => <option key={String(x.id)} value={String(x.id)}>{RWA_DOCUMENT_KINDS[x.kind as RwaDocumentKind]} · {String(x.filename)}</option>)}
      </select></Field>
    </div>}
    <Field label={kind === "note" ? "Note (internal, never shown to the applicant)" : "What was checked and the outcome"}><textarea className="nx-wallet-input" rows={3} value={body} onChange={e => setBody(e.target.value)} required minLength={3} maxLength={4000}/></Field>
    <div className="nx-rwa-actions"><button className="nx-rwa-button primary" disabled={busy}>{kind === "note" ? "Add note" : "Record finding"}</button></div>
    {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
  </form>;
}

function Tokenization({ d, can, onDone }: { d: Detail; can: (p: string) => boolean; onDone: () => void }) {
  const cfg = d.tokenConfig;
  const ref = String(d.application.reference);
  const [legal, setLegal] = useState("");
  const [legalDoc, setLegalDoc] = useState("");
  const [matches, setMatches] = useState(false);
  const [issuerOk, setIssuerOk] = useState(false);
  const [deploy, setDeploy] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string; missing?: string[] } | null>(null);
  const [onChain, setOnChain] = useState<R | null>(null);

  if (d.application.status !== "approved" && d.application.status !== "suspended") return <p className="nx-admin-help">Tokenization unlocks for the issuer after approval.</p>;
  if (!cfg) return <p className="nx-admin-help">The issuer hasn’t configured the token yet.</p>;
  const act = async (body: R) => {
    setBusy(true); setMsg(null);
    const r = await api<{ missing?: string[] }>(`/api/admin/applications/${ref}/token-config`, { body });
    setBusy(false);
    if (r.ok) { setMsg({ kind: "success", text: "Recorded." }); onDone(); } else setMsg({ kind: "error", text: r.error, missing: r.data.missing as string[] | undefined });
  };
  return <>
    <Facts items={[
      ["Status", <StatusBadge key="s" kind="token" status={String(cfg.status)}/>],
      ["Token code", String(cfg.token_code)], ["Total supply", fmtAmount(cfg.total_supply)],
      ["Price", fmtAmount(cfg.price_amount, cfg.price_currency)], ["Minimum investment", `${fmtAmount(cfg.min_investment)} tokens`],
      ["Distribution address", <code key="d">{String(cfg.distributor_address)}</code>],
      ["On-chain controls", `Authorization required + revocable${cfg.clawback_enabled ? " + clawback" : ""}`],
      ...TOKEN_TEXT_FIELDS.map(([k, label]) => [label, String(cfg[k] ?? "")] as [string, string]),
      ...(d.tokenAuthorization?.authorized_at ? [["Authorised", `${fmtDate(d.tokenAuthorization.authorized_at, true)} · expires ${fmtDate(d.tokenAuthorization.authorization_expires_at, true)}`] as [string, string]] : []),
      ...(cfg.issuer_address ? [["Issuer account", <code key="i">{String(cfg.issuer_address)}</code>] as [string, React.ReactNode], ["Issuance transaction", <Link key="t" href={`/receipt/${cfg.issued_tx_hash}`}>{String(cfg.issued_tx_hash).slice(0, 16)}…</Link>] as [string, React.ReactNode]] : [])
    ]}/>
    <h3 className="nx-admin-subhead">System checks</h3>
    <ul className="nx-rwa-checklist">{d.checklist.map(c => <li key={c.key} className={c.ok ? "ok" : "missing"}>{c.ok ? "✓" : "✗"} {c.label}</li>)}</ul>

    {cfg.status === "submitted" && can("tokenization.authorize") && <form className="nx-admin-form" onSubmit={e => { e.preventDefault(); void act({ action: "authorize", legalClearanceDocumentId: legalDoc, legalClearanceRef: legal, configMatchesOffering: matches, issuerAuthorized: issuerOk, authorizeDeployment: deploy }); }}>
      <h3 className="nx-admin-subhead">Reviewer confirmations</h3>
      <Field label="Legal clearance document" hint={d.legalClearanceDocuments.length ? "The evidence for legal clearance. Only legal opinion / regulatory clearance documents recorded as verified under Findings are listed." : "None yet: the issuer uploads the legal opinion / regulatory clearance, then a reviewer records a verified “Legal & regulatory clearance” finding citing it."}>
        <select className="nx-wallet-input" value={legalDoc} onChange={e => setLegalDoc(e.target.value)}>
          <option value="">— choose a verified document —</option>
          {d.legalClearanceDocuments.map(x => <option key={x.id} value={x.id}>{x.filename} · verified {fmtDate(x.verified_at)}</option>)}
        </select>
      </Field>
      <Field label="Counsel / regulator reference" hint="Firm, opinion or approval number. Describes the document above; it is not accepted as evidence on its own."><input className="nx-wallet-input" value={legal} onChange={e => setLegal(e.target.value)} maxLength={300} required/></Field>
      <label className="nx-wallet-check"><input type="checkbox" checked={matches} onChange={e => setMatches(e.target.checked)}/>The configuration matches the offering documents.</label>
      <label className="nx-wallet-check"><input type="checkbox" checked={issuerOk} onChange={e => setIssuerOk(e.target.checked)}/>The issuer is authorised to tokenize this asset.</label>
      <label className="nx-wallet-check"><input type="checkbox" checked={deploy} onChange={e => setDeploy(e.target.checked)}/>I authorise the issuer to issue this token on Stellar Mainnet from their own wallet (valid {d.settings.authorizationValidityDays} days).</label>
      <div className="nx-rwa-actions"><button className="nx-rwa-button primary" disabled={busy}>Authorise issuance</button></div>
    </form>}

    {(cfg.status === "submitted" || cfg.status === "authorized") && can("tokenization.authorize") && <form className="nx-admin-form" onSubmit={e => { e.preventDefault(); void act({ action: cfg.status === "submitted" ? "return" : "revoke", reason }); }}>
      <Field label={cfg.status === "submitted" ? "Request changes (reason)" : "Revoke authorization (reason)"}><input className="nx-wallet-input" value={reason} onChange={e => setReason(e.target.value)} minLength={5} required/></Field>
      <div className="nx-rwa-actions"><button className="nx-rwa-button danger" disabled={busy}>{cfg.status === "submitted" ? "Return to issuer" : "Revoke authorization"}</button></div>
    </form>}

    {cfg.status === "issued" && can("assets.manage") && !!d.application.published && <Field label="Reason for unlisting (required to unlist)"><input className="nx-wallet-input" value={reason} onChange={e => setReason(e.target.value)} maxLength={1000}/></Field>}
    {cfg.status === "issued" && can("assets.manage") && <div className="nx-rwa-actions">
      <button className="nx-rwa-button primary" disabled={busy || d.application.status !== "approved" || (!!d.application.published && reason.trim().length < 5)} onClick={async () => {
        const published = !d.application.published;
        setBusy(true); setMsg(null);
        const r = await api(`/api/admin/applications/${ref}/publish`, { body: { published, reason } });
        setBusy(false);
        if (r.ok) { setReason(""); onDone(); } else setMsg({ kind: "error", text: r.error });
      }}>{d.application.published ? "Unlist offering" : "List offering on the explorer"}</button>
      <button className="nx-rwa-button" disabled={busy} onClick={async () => {
        setBusy(true);
        const r = await api<{ onChain: R }>(`/api/admin/assets/${ref}`);
        setBusy(false);
        if (r.ok) setOnChain(r.data.onChain); else setMsg({ kind: "error", text: r.error });
      }}>Check on-chain state</button>
      <a className="nx-rwa-button" href={`https://stellar.expert/explorer/public/asset/${cfg.token_code}-${cfg.issuer_address}`} target="_blank" rel="noreferrer">Stellar Expert <ExternalLink size={12}/></a>
    </div>}
    {onChain && <OnChainFacts data={onChain}/>}
    {msg && <Notice kind={msg.kind}>{msg.text}{msg.missing && <ul>{msg.missing.map(m => <li key={m}>{m}</li>)}</ul>}</Notice>}
  </>;
}

export function OnChainFacts({ data }: { data: R }) {
  const yes = (v: unknown) => v === true ? "Yes" : "No";
  const bal = data.balances as R | null;
  return <Facts items={[
    ["Issuer account exists", yes(data.issuerExists)], ["Authorization required", yes(data.authRequired)], ["Revocable", yes(data.authRevocable)],
    ["Clawback enabled", yes(data.clawbackEnabled)], ["Issuer master key weight", String(data.issuerMasterWeight ?? "—")],
    ["Authorised holders", String((data.accounts as R | null)?.authorized ?? "—")], ["Supply held by authorised accounts", fmtAmount(bal?.authorized)],
    ["Configured supply", fmtAmount(data.configuredSupply)]
  ]}/>;
}

function AdminEventForm({ reference, onDone }: { reference: string; onDone: () => void }) {
  const kinds = (Object.keys(EVENT_KINDS) as EventKind[]).filter(k => k !== "redemption_request" && k !== "status_change");
  const [kind, setKind] = useState<EventKind>("inspection_report");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [share, setShare] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  return <form className="nx-admin-form" onSubmit={async e => {
    e.preventDefault();
    const form = new FormData();
    form.set("kind", kind); form.set("title", title); form.set("body", body); form.set("public", String(share));
    if (file) form.set("file", file);
    setBusy(true); setMsg(null);
    const r = await api(`/api/admin/applications/${reference}/events`, { form });
    setBusy(false);
    if (r.ok) { setTitle(""); setBody(""); setFile(null); setMsg({ kind: "success", text: "Recorded." }); onDone(); } else setMsg({ kind: "error", text: r.error });
  }}>
    <div className="nx-rwa-grid">
      <Field label="Type"><select className="nx-wallet-input" value={kind} onChange={e => setKind(e.target.value as EventKind)}>{kinds.map(k => <option key={k} value={k}>{EVENT_KINDS[k]}</option>)}</select></Field>
      <Field label="Title"><input className="nx-wallet-input" value={title} onChange={e => setTitle(e.target.value)} required minLength={3} maxLength={160}/></Field>
    </div>
    <Field label="Details"><textarea className="nx-wallet-input" rows={2} value={body} onChange={e => setBody(e.target.value)} maxLength={4000}/></Field>
    <Field label="Supporting file (optional, PDF/PNG/JPEG ≤ 4 MB)"><input type="file" accept="application/pdf,image/png,image/jpeg" onChange={e => setFile(e.target.files?.[0] ?? null)}/></Field>
    <label className="nx-wallet-check"><input type="checkbox" checked={share} onChange={e => setShare(e.target.checked)}/>Show on the public offering page</label>
    <div className="nx-rwa-actions"><button className="nx-rwa-button primary" disabled={busy}>Add record</button></div>
    {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
  </form>;
}

export function EventList({ events, reference, canManage, onDone }: { events: R[]; reference: string; canManage: boolean; onDone: () => void }) {
  const [error, setError] = useState("");
  if (!events.length) return <Empty>No lifecycle records yet.</Empty>;
  const patch = async (eventId: unknown, body: R) => {
    const r = await api(`/api/admin/applications/${reference}/events`, { method: "PATCH", body: { eventId, ...body } });
    if (r.ok) onDone(); else setError(r.error);
  };
  return <>
    {error && <Notice kind="error">{error}</Notice>}
    <ul className="nx-admin-feed">{events.map(ev => <li key={String(ev.id)}>
      <strong>{EVENT_KINDS[ev.kind as EventKind]} · {String(ev.title)} <StatusBadge kind="other" status={String(ev.status)}/></strong>
      {ev.body ? <span>{String(ev.body)}</span> : null}
      <small>
        {ev.source === "on_chain" ? "On-chain" : ev.source === "admin" ? "NEXORA" : ev.source === "investor" ? "Investor" : "Issuer"} (off-chain record unless marked on-chain)
        {ev.amount ? ` · ${fmtAmount(ev.amount, ev.currency)}` : ""}{ev.event_date ? ` · ${fmtDate(ev.event_date)}` : ""} · {fmtDate(ev.created_at, true)} · {ev.public ? "public" : "private"}
        {ev.tx_hash ? <> · <Link href={`/receipt/${ev.tx_hash}`}>transaction</Link></> : null}
        {ev.document_id ? <> · <a href={`/api/admin/documents/${ev.document_id}`} download>file</a></> : null}
      </small>
      {canManage && ev.kind !== "status_change" && <div className="nx-rwa-actions">
        {(ev.status === "pending_review" || ev.status === "acknowledged") && <>
          {ev.status === "pending_review" && <button className="nx-rwa-button" onClick={() => void patch(ev.id, { status: "acknowledged" })}>Acknowledge</button>}
          <button className="nx-rwa-button" onClick={() => void patch(ev.id, { status: "resolved" })}>Mark resolved</button>
        </>}
        <button className="nx-rwa-button" onClick={() => void patch(ev.id, { public: !ev.public })}>{ev.public ? "Make private" : "Make public"}</button>
      </div>}
    </li>)}</ul>
  </>;
}
