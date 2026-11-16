"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, LoaderCircle, MinusCircle, X } from "lucide-react";

type Evidence = {
  status: "ok" | "issuer_not_found";
  asset: string;
  onChain: { exists: boolean; authRequired: boolean; authRevocable: boolean; authImmutable: boolean; clawbackEnabled: boolean; issuerLocked: boolean; holders: number | null; circulating: string | null; homeDomain: string | null };
  domainLink: { status: "linked" | "not_listed" | "no_domain" | "unavailable" };
  published: null | { orgName: string | null; orgUrl: string | null; name: string | null; description: string | null; isAnchored: boolean; anchorAssetType: string | null; anchorAsset: string | null;
    attestation: string | null; redemption: string | null; regulated: boolean; approvalServer: string | null; approvalCriteria: string | null; conditions: string | null; status: string | null; fixedNumber: boolean };
  retrievedAt: string;
};

const yes = (v: boolean) => v ? "Yes" : "No";

/** Evidence-only issuer view: on-chain facts, SEP-1 domain link, and clearly labelled issuer-published claims. */
export default function IssuerEvidence({ code, issuer, onClose }: { code: string; issuer: string; onClose: () => void }) {
  const [data, setData] = useState<Evidence | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/stellar/issuer?asset=${encodeURIComponent(code)}:${issuer}`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error("x")))
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [code, issuer]);

  const link = data?.domainLink.status;
  const p = data?.published;
  return <div className="nx-command-overlay nx-wallet-overlay" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="nx-wallet-dialog nx-voucher-dialog" role="dialog" aria-modal="true" aria-label="Issuer evidence">
      <header className="nx-wallet-dialog-head"><span/><strong>{code} issuer</strong><button type="button" className="nx-wallet-dialog-icon" aria-label="Close" onClick={onClose}><X size={16}/></button></header>
      <div className="nx-wallet-dialog-body">
        <code className="nx-receipt-hash">{issuer}</code>
        {!data && !failed && <p className="nx-wallet-lede"><LoaderCircle className="nx-spin" size={16}/> Loading…</p>}
        {failed && <p className="nx-wallet-error">Couldn’t load issuer details. Try again shortly.</p>}
        {data?.status === "issuer_not_found" && <p className="nx-wallet-error">This issuer account doesn’t exist on Stellar.</p>}
        {data?.status === "ok" && <>
          <div className="nx-wallet-field-label">On Stellar</div>
          <dl className="nx-review-list">
            <div><dt>Holders</dt><dd>{data.onChain.holders?.toLocaleString() ?? "—"}</dd></div>
            <div><dt>Circulating</dt><dd>{data.onChain.circulating ? Number(data.onChain.circulating).toLocaleString(undefined, { maximumFractionDigits: 7 }) : "—"}</dd></div>
            <div><dt>Holder approval required</dt><dd>{yes(data.onChain.authRequired)}</dd></div>
            <div><dt>Issuer can freeze holdings</dt><dd>{yes(data.onChain.authRevocable)}</dd></div>
            <div><dt>Issuer can claw back</dt><dd>{yes(data.onChain.clawbackEnabled)}</dd></div>
            <div><dt>Supply can still grow</dt><dd>{data.onChain.issuerLocked ? "No (issuer locked)" : "Yes"}</dd></div>
          </dl>

          <div className={`nx-evidence-link nx-evidence-${link}`}>
            {link === "linked" ? <CheckCircle2 size={16}/> : link === "no_domain" ? <MinusCircle size={16}/> : <AlertTriangle size={16}/>}
            <span>{link === "linked" ? <>Issuer domain <strong>{data.onChain.homeDomain}</strong> lists this asset</>
              : link === "not_listed" ? <><strong>{data.onChain.homeDomain}</strong> does not list this asset — treat its branding with caution</>
              : link === "no_domain" ? "No issuer domain is linked to this account"
              : "The issuer domain couldn’t be checked right now"}</span>
          </div>

          {p && <>
            <div className="nx-wallet-field-label">Published by the issuer · not independently verified</div>
            <dl className="nx-review-list">
              {p.orgName && <div><dt>Organisation</dt><dd>{p.orgUrl ? <a href={p.orgUrl} target="_blank" rel="noreferrer">{p.orgName} <ExternalLink size={10}/></a> : p.orgName}</dd></div>}
              {p.name && <div><dt>Name</dt><dd>{p.name}</dd></div>}
              {p.isAnchored && <div><dt>Represents</dt><dd>{[p.anchorAssetType, p.anchorAsset].filter(Boolean).join(" · ") || "An off-chain asset"}</dd></div>}
              {p.attestation && <div><dt>Reserve attestation</dt><dd><a href={p.attestation} target="_blank" rel="noreferrer">Issuer document <ExternalLink size={10}/></a></dd></div>}
              {p.regulated && <div><dt>Transfers</dt><dd>Require issuer approval{p.approvalServer ? " (approval server)" : ""}</dd></div>}
              {p.status && <div><dt>Status</dt><dd>{p.status}</dd></div>}
            </dl>
            {p.description && <p className="nx-evidence-text">{p.description}</p>}
            {p.redemption && <p className="nx-evidence-text"><strong>Redemption:</strong> {p.redemption}</p>}
            {(p.conditions || p.approvalCriteria) && <p className="nx-evidence-text"><strong>Eligibility &amp; conditions:</strong> {[p.conditions, p.approvalCriteria].filter(Boolean).join(" ")}</p>}
          </>}
          {(data.onChain.authRequired || p?.regulated) && <p className="nx-evidence-text">Holding this asset requires the issuer’s approval of your account. Check the issuer’s eligibility rules for your jurisdiction.</p>}
        </>}
      </div>
    </section>
  </div>;
}
