"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Building2, Download, ExternalLink, Landmark, LoaderCircle, ShieldAlert } from "lucide-react";
import { useStellarWallet } from "@/components/wallet/WalletProvider";
import { api, fmtAmount, fmtDate, short } from "./api";
import { useAccount } from "./useAccount";
import { AuthForms, SubscriptionRow } from "./AccountExperience";
import { Empty, EvidenceBadge, Facts, Field, Notice, Section, StatusBadge } from "./ui";
import { EVENT_KINDS, RWA_CATEGORIES, RWA_DOCUMENT_KINDS, type EventKind, type RwaCategory, type RwaDocumentKind } from "@/lib/rwa";

type R = Record<string, unknown>;

function Heading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <div className="nx-page-heading"><div><div className="nx-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{actions}</div>;
}

/* ───────────── Explorer ───────────── */

export function RwaOfferings() {
  const [data, setData] = useState<{ available: boolean; subscriptionsOpen: boolean; offerings: R[] } | null>(null);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("");
  useEffect(() => { void api<{ available: boolean; subscriptionsOpen: boolean; offerings: R[] }>("/api/rwa/offerings").then(r => r.ok ? setData(r.data) : setError(r.error)); }, []);
  const list = (data?.offerings ?? []).filter(o => !category || o.category === category);
  return <>
    <Heading eyebrow="REAL-WORLD ASSETS" title="Tokenized asset offerings"
      description="Offerings reviewed by NEXORA, authorised for issuance and issued on Stellar with transfer controls. Every offering shows what was verified and what is only declared by the issuer."
      actions={<div className="nx-rwa-actions"><Link className="nx-rwa-button primary" href="/rwa/apply"><Building2 size={14}/> Tokenize an asset</Link><Link className="nx-rwa-button" href="/account">My account</Link></div>}/>
    {error && <Notice kind="error">{error}</Notice>}
    {data && !data.available && <Notice kind="info">RWA offerings aren’t available on this deployment yet.</Notice>}
    {data?.available && <>
      <div className="nx-admin-tabs nx-rwa-filter" role="tablist" aria-label="Category">
        <button role="tab" aria-selected={!category} className={!category ? "active" : undefined} onClick={() => setCategory("")}>All</button>
        {Object.entries(RWA_CATEGORIES).map(([k, v]) => <button key={k} role="tab" aria-selected={category === k} className={category === k ? "active" : undefined} onClick={() => setCategory(k)}>{v}</button>)}
      </div>
      {list.length === 0 ? <section className="nx-panel"><Empty>No offerings are listed{category ? " in this category" : ""} yet.</Empty></section> :
        <div className="nx-rwa-cards">{list.map(o => <Link key={String(o.reference)} href={`/rwa/${o.reference}`} className="nx-panel nx-rwa-card nx-rwa-offer">
          <div className="nx-rwa-card-head"><div><small>{RWA_CATEGORIES[o.category as RwaCategory]} · {String(o.country || "")}</small><h3>{String(o.asset_name)}</h3><small>{String(o.issuer_legal_name)}</small></div><span className="nx-rwa-token">{String(o.token_code)}</span></div>
          <dl className="nx-rwa-facts nx-rwa-facts-compact">
            <div><dt>Valuation</dt><dd>{fmtAmount(o.valuation_amount, o.valuation_currency)}</dd></div>
            <div><dt>Valued on</dt><dd>{fmtDate(o.valuation_date)}</dd></div>
            <div><dt>Price / token</dt><dd>{fmtAmount(o.price_amount, o.price_currency)}</dd></div>
            <div><dt>Minimum</dt><dd>{fmtAmount(o.min_investment)} tokens</dd></div>
          </dl>
          <em>View offering <ArrowUpRight size={13}/></em>
        </Link>)}</div>}
      <div className="nx-info-note"><ShieldAlert size={15}/> Tokenized assets can lose value and may be hard to sell or redeem. Returns and liquidity are not guaranteed.</div>
    </>}
  </>;
}

/* ───────────── Start an application ───────────── */

export function RwaApply() {
  const acc = useAccount();
  const router = useRouter();
  const [category, setCategory] = useState("real_estate");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const head = <Heading eyebrow="TOKENIZE AN ASSET" title="Apply to tokenize a real-world asset"
    description="Start an application with the asset’s details and supporting documents. NEXORA reviews it; tokenization is only possible after approval and a separate final authorization." />;
  if (acc.loading) return head;
  if (!acc.available) return <>{head}<Notice kind="info">Applications aren’t available on this deployment yet.</Notice></>;
  if (!acc.user) return <>{head}<AuthForms onDone={acc.reload}/></>;
  return <>{head}
    <section className="nx-panel nx-rwa-auth">
      <form className="nx-admin-form" onSubmit={async e => {
        e.preventDefault();
        setBusy(true); setError("");
        const r = await api<{ reference: string }>("/api/rwa/applications", { body: { category, asset_name: name } });
        setBusy(false);
        if (r.ok) router.push(`/rwa/applications/${r.data.reference}`); else setError(r.error);
      }}>
        <Field label="Asset category"><select className="nx-wallet-input" value={category} onChange={e => setCategory(e.target.value)}>{Object.entries(RWA_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Asset name"><input className="nx-wallet-input" value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={120}/></Field>
        {error && <Notice kind="error">{error}</Notice>}
        <button className="nx-wallet-primary" disabled={busy}>{busy && <LoaderCircle className="nx-spin" size={15}/>}Start application</button>
      </form>
    </section>
  </>;
}

/* ───────────── Offering detail ───────────── */

type Offering = {
  offering: R & { token: R; documents: R[]; events: R[]; verification: R[] };
  riskDisclosure: string; subscriptionsOpen: boolean;
  viewer: { signedIn: boolean; verified?: boolean; isIssuer?: boolean };
  mySubscriptions: R[];
};

export function RwaOffering({ reference }: { reference: string }) {
  const [d, setD] = useState<Offering | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const r = await api<Offering>(`/api/rwa/offerings/${reference}`);
    if (r.ok) setD(r.data); else setError(r.error);
  }, [reference]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);
  if (error) return <><Link className="nx-admin-back" href="/rwa">← Offerings</Link><Notice kind="error">{error}</Notice></>;
  if (!d) return <p className="nx-wallet-lede"><LoaderCircle className="nx-spin" size={16}/> Loading…</p>;
  const o = d.offering, t = o.token;
  const verified = new Map(o.verification.map(v => [String(v.subject), String(v.status)]));
  const ev = (subject: string) => <EvidenceBadge status={verified.get(subject) ?? "declared"}/>;
  return <>
    <Link className="nx-admin-back" href="/rwa">← Offerings</Link>
    <Heading eyebrow={`${RWA_CATEGORIES[o.category as RwaCategory]} · ${String(o.reference)}`} title={String(o.asset_name)} description={String(o.description)}
      actions={<div className="nx-admin-heading-badges"><StatusBadge status="approved" label="Approved by NEXORA"/><StatusBadge status="issued" label={`${t.code} issued`}/></div>}/>
    <div className="nx-admin-grid-2">
      <div>
        <Section kicker="ISSUER" title="Issuer & asset">
          <Facts items={[
            ["Legal issuer", <span key="i">{String(o.issuer_legal_name)} {ev("issuer")}</span>],
            ["Registration", String(o.issuer_registration)],
            ["Country / jurisdiction", `${String(o.country)} · ${String(o.jurisdiction)}`],
            ["Valuation", <span key="v">{fmtAmount(o.valuation_amount, o.valuation_currency)} (as of {fmtDate(o.valuation_date)}) {ev("valuation")}</span>],
            ["Custodian", <span key="c">{String(o.custodian)} {ev("custody")}</span>],
            ["Insurance", <span key="n">{String(o.insurance || "None declared")} {o.insurance ? ev("insurance") : null}</span>],
            ["Legal ownership structure", <span key="l">{String(o.legal_structure)} {ev("legal_structure")}</span>],
            ["Ownership", ev("ownership")]
          ]}/>
          <p className="nx-admin-help">“Issuer declaration” means NEXORA has not independently verified the item.</p>
        </Section>
        <Section kicker="TOKEN" title={`${t.code} terms`}>
          <Facts items={[
            ["Total supply", fmtAmount(t.total_supply)], ["Price per token", fmtAmount(t.price_amount, t.price_currency)],
            ["Minimum investment", `${fmtAmount(t.min_investment)} tokens`],
            ["Rights", String(t.token_rights)], ["Ownership structure", String(t.ownership_structure)], ["Distributions", String(t.distribution_rules)],
            ["Investor eligibility", String(t.investor_eligibility)], ["Transfer restrictions", String(t.transfer_restrictions)],
            ["Redemption", String(t.redemption_terms)],
            ["On-chain controls", `Issuer approval required for every holder${t.clawback_enabled ? "; issuer can recover tokens (clawback)" : ""}`],
            ["Issuer account", <code key="a">{short(t.issuer)}</code>],
            ["Issued", <span key="d">{fmtDate(t.issued_at)} · <Link href={`/receipt/${t.issued_tx_hash}`}>receipt</Link> · <a href={`https://stellar.expert/explorer/public/asset/${t.code}-${t.issuer}`} target="_blank" rel="noreferrer">Stellar Expert <ExternalLink size={11}/></a></span>]
          ]}/>
        </Section>
      </div>
      <div>
        <Section kicker="RISK" title="Risk disclosure"><p className="nx-rwa-risk">{d.riskDisclosure}</p></Section>
        <Subscribe d={d} reference={reference} onChange={load}/>
        <Section kicker="DOCUMENTS" title="Offering documents">
          {o.documents.length === 0 ? <Empty>No public documents.</Empty> : <ul className="nx-rwa-docs">{o.documents.map(doc =>
            <li key={String(doc.id)}><div><strong>{RWA_DOCUMENT_KINDS[doc.kind as RwaDocumentKind]}</strong><small>{String(doc.filename)} · SHA-256 {String(doc.sha256).slice(0, 12)}…</small></div>
              <a className="nx-rwa-button" href={`/api/rwa/documents/${doc.id}`} download><Download size={13}/> Download</a></li>)}</ul>}
        </Section>
        <Section kicker="LIFECYCLE" title="Asset history">
          {o.events.length === 0 ? <Empty>No updates yet.</Empty> : <ul className="nx-admin-feed">{o.events.map((e, i) => <li key={i}>
            <strong>{EVENT_KINDS[e.kind as EventKind]} · {String(e.title)}</strong>{e.body ? <span>{String(e.body)}</span> : null}
            <small>{e.source === "on_chain" ? "On-chain" : e.source === "admin" ? "Reported by NEXORA (off-chain)" : "Reported by the issuer (off-chain)"}{e.amount ? ` · ${fmtAmount(e.amount, e.currency)}` : ""} · {fmtDate(e.event_date ?? e.created_at)}{e.tx_hash ? <> · <Link href={`/receipt/${e.tx_hash}`}>transaction</Link></> : null}</small>
          </li>)}</ul>}
        </Section>
      </div>
    </div>
  </>;
}

function Subscribe({ d, reference, onChange }: { d: Offering; reference: string; onChange: () => void }) {
  const acc = useAccount();
  const { address, requestWallet } = useStellarWallet();
  const t = d.offering.token;
  const [amount, setAmount] = useState(String(t.min_investment ?? ""));
  const [eligible, setEligible] = useState(false);
  const [risks, setRisks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [redeem, setRedeem] = useState({ amount: "", details: "" });
  const open = d.mySubscriptions.find(s => ["requested", "accepted", "authorized"].includes(String(s.status)));
  const delivered = d.mySubscriptions.some(s => s.status === "delivered");

  return <Section kicker="INVEST" title="Subscribe">
    {d.mySubscriptions.length > 0 && <ul className="nx-rwa-list">{d.mySubscriptions.map(s => <li key={String(s.id)}>
      <SubscriptionRow sub={{ ...(s as Record<string, string>), id: String(s.id), investor_address: String(s.investor_address), amount: String(s.amount), status: String(s.status), decision_reason: (s.decision_reason as string | null) ?? null, created_at: String(s.created_at), reference, asset_name: String(d.offering.asset_name), token_code: String(t.code), issuer_address: String(t.issuer) }} onChange={onChange}/></li>)}</ul>}
    {!d.subscriptionsOpen ? <Notice kind="info">Subscriptions aren’t open on NEXORA at the moment.</Notice>
      : d.viewer.isIssuer ? <p className="nx-admin-help">You are the issuer of this offering.</p>
      : !d.viewer.signedIn ? (acc.user ? null : <><p className="nx-admin-help">Sign in to request a subscription.</p><AuthForms onDone={() => { void acc.reload(); onChange(); }}/></>)
      : open ? <p className="nx-admin-help">Your request is in progress. After the issuer accepts it, add the trustline from your wallet; the issuer then authorises it and delivers the tokens.</p>
      : <form className="nx-admin-form" onSubmit={async e => {
        e.preventDefault();
        const wallet = address ?? await requestWallet();
        if (!wallet) return;
        setBusy(true); setMsg(null);
        const r = await api(`/api/rwa/offerings/${reference}/subscriptions`, { body: { amount, investorAddress: wallet, eligibilityAttested: eligible, risksAcknowledged: risks } });
        setBusy(false);
        if (r.ok) { setMsg({ kind: "success", text: "Request sent to the issuer. Nothing is charged or transferred until the issuer accepts and you complete the steps." }); onChange(); }
        else setMsg({ kind: "error", text: r.error });
      }}>
        <Field label={`Tokens (minimum ${fmtAmount(t.min_investment)})`}><input className="nx-wallet-input" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} required/></Field>
        <p className="nx-admin-help">Indicative value: {fmtAmount(Number(amount || 0) * Number(t.price_amount), t.price_currency)}. Settlement terms are agreed with the issuer.</p>
        <label className="nx-wallet-check"><input type="checkbox" checked={eligible} onChange={e => setEligible(e.target.checked)}/>I meet the investor eligibility requirements: {String(t.investor_eligibility)}</label>
        <label className="nx-wallet-check"><input type="checkbox" checked={risks} onChange={e => setRisks(e.target.checked)}/>I have read the risk disclosure and offering documents.</label>
        {address ? <p className="nx-admin-help">Tokens will be delivered to {short(address)}.</p> : <p className="nx-admin-help">You’ll be asked to set up or unlock your wallet.</p>}
        <button className="nx-wallet-primary" disabled={busy || !eligible || !risks}>Request subscription</button>
      </form>}
    {delivered && <form className="nx-admin-form nx-rwa-redeem" onSubmit={async e => {
      e.preventDefault();
      const r = await api(`/api/rwa/offerings/${reference}/redemptions`, { body: redeem });
      setMsg(r.ok ? { kind: "success", text: "Redemption request sent to the issuer." } : { kind: "error", text: r.error });
      if (r.ok) setRedeem({ amount: "", details: "" });
    }}>
      <strong><Landmark size={14}/> Request redemption</strong>
      <Field label="Tokens to redeem"><input className="nx-wallet-input" inputMode="decimal" value={redeem.amount} onChange={e => setRedeem({ ...redeem, amount: e.target.value })} required/></Field>
      <Field label="Details for the issuer"><textarea className="nx-wallet-input" rows={2} value={redeem.details} onChange={e => setRedeem({ ...redeem, details: e.target.value })} maxLength={2000}/></Field>
      <button className="nx-rwa-button primary">Send request</button>
    </form>}
    {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
  </Section>;
}
