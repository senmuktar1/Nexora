"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, LoaderCircle, XCircle } from "lucide-react";
import { FeeBumpTransaction, Networks, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { describeTransaction, shortKey, type DescribedTransaction } from "@/lib/stellar/describe";
import { explorerTx } from "@/lib/stellar/client";

type State =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "unavailable" }
  | { kind: "ready"; status: "confirmed" | "failed"; ledger: number; createdAt: string; feeCharged: string; described: DescribedTransaction };

/** Transaction receipt rendered from the on-chain envelope (decoded locally). */
export default function ReceiptExperience({ hash }: { hash: string }) {
  const valid = /^[0-9a-f]{64}$/.test(hash);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    fetch(`/api/stellar/tx?hash=${hash}`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error("unavailable")))
      .then(d => {
        if (cancelled) return;
        if (d.status === "not_found") { setState({ kind: "not_found" }); return; }
        let tx = TransactionBuilder.fromXDR(String(d.envelopeXdr), Networks.PUBLIC);
        if (tx instanceof FeeBumpTransaction) tx = tx.innerTransaction;
        setState({ kind: "ready", status: d.status, ledger: Number(d.ledger), createdAt: String(d.createdAt), feeCharged: String(d.feeCharged), described: describeTransaction(tx as Transaction) });
      })
      .catch(() => { if (!cancelled) setState({ kind: "unavailable" }); });
    return () => { cancelled = true; };
  }, [hash, valid]);

  const xlm = (stroops: string) => (Number(stroops) / 1e7).toFixed(7).replace(/\.?0+$/, "");

  return <div className="nx-receipt">
    <section className="nx-panel nx-receipt-panel">
      <div className="nx-panel-kicker">TRANSACTION RECEIPT</div>
      {!valid && <p className="nx-wallet-error">This receipt link isn’t valid.</p>}
      {valid && state.kind === "loading" && <p className="nx-wallet-lede"><LoaderCircle className="nx-spin" size={16}/> Loading…</p>}
      {valid && state.kind === "not_found" && <p>No transaction with this hash was found on Stellar.</p>}
      {valid && state.kind === "unavailable" && <p className="nx-wallet-error">Couldn’t load this receipt. Try again shortly.</p>}
      {state.kind === "ready" && <>
        <h1 className={state.status === "confirmed" ? "nx-receipt-ok" : "nx-receipt-failed"}>
          {state.status === "confirmed" ? <CheckCircle2 size={22}/> : <XCircle size={22}/>}
          {state.status === "confirmed" ? "Confirmed" : "Failed"}
        </h1>
        <dl className="nx-review-list">
          <div><dt>Date</dt><dd>{new Date(state.createdAt).toLocaleString()}</dd></div>
          <div><dt>Ledger</dt><dd>{state.ledger.toLocaleString()}</dd></div>
          <div><dt>Account</dt><dd>{shortKey(state.described.source)}</dd></div>
          <div><dt>Fee paid</dt><dd>{xlm(state.feeCharged)} XLM</dd></div>
          {state.described.memo && <div><dt>Memo</dt><dd>{state.described.memo}</dd></div>}
        </dl>
        {state.described.operations.map((op, i) => <div key={i} className="nx-approval-op">
          <strong>{op.title}</strong>
          <dl className="nx-review-list">{op.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        </div>)}
      </>}
      {valid && <a className="nx-wallet-link" href={explorerTx(hash)} target="_blank" rel="noreferrer">View on Stellar Expert <ExternalLink size={11}/></a>}
      {valid && <code className="nx-receipt-hash">{hash}</code>}
    </section>
  </div>;
}
