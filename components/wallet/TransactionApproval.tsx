"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import type { DescribedTransaction } from "@/lib/stellar/describe";

export type ApprovalRequest = {
  described: DescribedTransaction;
  title: string;
  /** Optional caller-provided estimates, shown separately and labelled as estimates. */
  estimates?: [string, string][];
};

/**
 * Wallet-owned approval sheet. Everything in the "Transaction" section is decoded
 * from the exact XDR that will be signed — never from caller-supplied text.
 */
export default function TransactionApproval({ request, onApprove, onReject }: {
  request: ApprovalRequest;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { described } = request;
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  // Brief arming delay so a double-click on the opener can't approve by accident.
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const arm = window.setTimeout(() => setArmed(true), 600);
    const tick = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onReject(); };
    window.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(arm); window.clearInterval(tick); window.removeEventListener("keydown", onKey); };
  }, [onReject]);

  const secondsLeft = described.validUntil ? described.validUntil - now : null;
  const expired = secondsLeft !== null && secondsLeft <= 5;

  return <div className="nx-command-overlay nx-wallet-overlay" role="presentation">
    <section className="nx-wallet-dialog" role="dialog" aria-modal="true" aria-label="Approve transaction">
      <header className="nx-wallet-dialog-head"><span/><strong>{request.title}</strong><button type="button" className="nx-wallet-dialog-icon" aria-label="Close" onClick={onReject}><X size={16}/></button></header>
      <div className="nx-wallet-dialog-body">
        {request.estimates && request.estimates.length > 0 && <dl className="nx-review-list nx-review-estimates">
          {request.estimates.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>}
        <div className="nx-wallet-field-label">Transaction</div>
        {described.operations.map((op, i) => <div key={i} className="nx-approval-op">
          <strong>{op.title}</strong>
          <dl className="nx-review-list">{op.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        </div>)}
        <dl className="nx-review-list">
          {described.memo && <div><dt>Memo</dt><dd>{described.memo}</dd></div>}
          <div><dt>Network fee (max)</dt><dd>{described.fee} XLM</dd></div>
          <div><dt>Expires</dt><dd>{expired ? "Expired" : secondsLeft !== null ? `in ${secondsLeft}s` : "—"}</dd></div>
        </dl>
        <div className="nx-approval-actions">
          <button type="button" className="nx-delete-cancel" onClick={onReject}>Reject</button>
          <button type="button" className="nx-wallet-primary" disabled={!armed || expired} onClick={onApprove}><ShieldCheck size={14}/> Approve</button>
        </div>
      </div>
    </section>
  </div>;
}
