"use client";

import { useEffect, useState } from "react";
import { api } from "@/components/rwa/api";
import { Field, Notice, Section } from "@/components/rwa/ui";
import { AdminHeading } from "./AdminOverview";

type S = { applicationsOpen: boolean; subscriptionsOpen: boolean; authorizationValidityDays: number; requireClawback: boolean; riskDisclosure: string };

export default function AdminSettings() {
  const [s, setS] = useState<S | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<{ settings: S }>("/api/admin/settings").then(r => r.ok ? setS(r.data.settings) : setError(r.error)); }, []);
  if (error) return <><AdminHeading kicker="PLATFORM" title="Settings"/><Notice kind="error">{error}</Notice></>;
  if (!s) return <AdminHeading kicker="PLATFORM" title="Settings"/>;
  const set = <K extends keyof S>(k: K, v: S[K]) => setS({ ...s, [k]: v });
  return <>
    <AdminHeading kicker="PLATFORM" title="Settings"/>
    <form onSubmit={async e => {
      e.preventDefault();
      setBusy(true); setMsg(null);
      const r = await api<{ settings: S }>("/api/admin/settings", { method: "PUT", body: s });
      setBusy(false);
      if (r.ok) { setS(r.data.settings); setMsg({ kind: "success", text: "Settings saved." }); } else setMsg({ kind: "error", text: r.error });
    }}>
      <Section kicker="RWA PROGRAMME" title="Applications & offerings">
        <div className="nx-admin-form">
          <label className="nx-wallet-check"><input type="checkbox" checked={s.applicationsOpen} onChange={e => set("applicationsOpen", e.target.checked)}/>Accept new RWA applications</label>
          <label className="nx-wallet-check"><input type="checkbox" checked={s.subscriptionsOpen} onChange={e => set("subscriptionsOpen", e.target.checked)}/>Allow investors to request subscriptions to listed offerings</label>
          <p className="nx-admin-help">Keep subscriptions closed until the offering’s legal and regulatory clearances cover the investors you will accept.</p>
        </div>
      </Section>
      <Section kicker="COMPLIANCE" title="Tokenization controls">
        <div className="nx-admin-form">
          <label className="nx-wallet-check"><input type="checkbox" checked={s.requireClawback} onChange={e => set("requireClawback", e.target.checked)}/>Require clawback (asset recovery) on every RWA token</label>
          <Field label="Issuance authorization validity (days)" hint="After this, an authorised but unissued token needs re-authorization.">
            <input className="nx-wallet-input" type="number" min={1} max={90} value={s.authorizationValidityDays} onChange={e => set("authorizationValidityDays", Number(e.target.value))} required/>
          </Field>
          <Field label="Risk disclosure shown on every offering"><textarea className="nx-wallet-input" rows={5} value={s.riskDisclosure} onChange={e => set("riskDisclosure", e.target.value)} minLength={40} maxLength={4000} required/></Field>
        </div>
      </Section>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="nx-rwa-actions"><button className="nx-rwa-button primary" disabled={busy}>Save settings</button></div>
    </form>
  </>;
}
