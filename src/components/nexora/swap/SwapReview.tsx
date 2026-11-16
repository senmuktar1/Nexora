"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, LoaderCircle, X } from "lucide-react";
import { useStellarWallet } from "@/components/wallet/WalletProvider";
import { buildSwap, SwapError, type SwapPlan } from "@/lib/stellar/swap";
import { loadAccount, loadFeePerOperation, submitSigned } from "@/lib/stellar/client";
import { guardMessage, TxGuardError, type AssetId } from "@/lib/stellar/tx-guard";

export type SwapQuote = { destAmount: string; path: AssetId[]; retrievedAt: string };

type Stage =
  | { kind: "preparing" }
  | { kind: "approving" }
  | { kind: "submitting" }
  | { kind: "done"; hash: string }
  | { kind: "pending"; hash: string }
  | { kind: "error"; message: string };

const code = (id: AssetId) => id === "native" ? "XLM" : id.split(":")[0];

async function loadQuote(sendAsset: AssetId, destAsset: AssetId, sendAmount: string): Promise<SwapQuote | null> {
  const qs = new URLSearchParams({ sendAsset, destAsset, sendAmount });
  const response = await fetch(`/api/stellar/paths?${qs}`, { cache: "no-store" });
  if (!response.ok) throw new Error("unavailable");
  const data = await response.json();
  const best = data.routes?.[0];
  return best ? { destAmount: best.destAmount, path: best.path, retrievedAt: data.retrievedAt } : null;
}

export default function SwapReview({ address, sendAsset, destAsset, sendAmount, slippageBps, onClose }: {
  address: string; sendAsset: AssetId; destAsset: AssetId; sendAmount: string; slippageBps: number; onClose: () => void;
}) {
  const { signTransaction } = useStellarWallet();
  const [stage, setStage] = useState<Stage>({ kind: "preparing" });

  // Refs keep the effect from re-running (and re-requesting approval) when callbacks change identity.
  const signRef = useRef(signTransaction);
  const closeRef = useRef(onClose);
  useEffect(() => { signRef.current = signTransaction; closeRef.current = onClose; }, [signTransaction, onClose]);

  useEffect(() => {
    let cancelled = false;
    async function approveAndSubmit(plan: SwapPlan) {
      if (cancelled) return;
      setStage({ kind: "approving" });
      let signed: string;
      try {
        signed = await signRef.current(plan.xdr, plan.intent, {
          title: "Approve swap",
          estimates: [["Estimated receive", `${plan.review.expected} ${code(plan.review.destAsset)}`]]
        });
      } catch (error) {
        if (error instanceof TxGuardError) setStage({ kind: "error", message: guardMessage(error) });
        else closeRef.current();
        return;
      }
      setStage({ kind: "submitting" });
      const outcome = await submitSigned(signed);
      if (outcome.status === "confirmed") setStage({ kind: "done", hash: outcome.hash });
      else if (outcome.status === "pending") setStage({ kind: "pending", hash: outcome.hash });
      else setStage({ kind: "error", message: outcome.message });
    }

    (async () => {
      try {
        // Always rebuild from fresh account, quote and fee data.
        const [account, quote, fee] = await Promise.all([
          loadAccount(address),
          loadQuote(sendAsset, destAsset, sendAmount),
          loadFeePerOperation()
        ]);
        if (cancelled) return;
        if (!quote) { setStage({ kind: "error", message: "No route is available for this pair right now." }); return; }
        const plan = buildSwap({ account, sendAsset, sendAmount, destAsset, quotedDestAmount: quote.destAmount, path: quote.path, slippageBps, feePerOperation: fee });
        void approveAndSubmit(plan);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof SwapError
          ? error.code === "insufficient_balance" ? "Insufficient balance after network reserves and fees." : "Check the amount and try again."
          : error instanceof Error && error.message === "inactive" ? "Your account isn't active yet. Fund it with at least 1 XLM first."
          : "Network is unavailable. Try again shortly.";
        setStage({ kind: "error", message });
      }
    })();
    return () => { cancelled = true; };
  }, [address, sendAsset, destAsset, sendAmount, slippageBps]);


  const busy = stage.kind === "preparing" || stage.kind === "approving" || stage.kind === "submitting";
  if (stage.kind === "approving") return null;

  return <div className="nx-command-overlay nx-wallet-overlay" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section className="nx-wallet-dialog" role="dialog" aria-modal="true" aria-label="Review swap">
      <header className="nx-wallet-dialog-head"><span/><strong>{stage.kind === "done" ? "Swap complete" : "Swap"}</strong><button type="button" className="nx-wallet-dialog-icon" aria-label="Close" onClick={onClose} disabled={busy}><X size={16}/></button></header>
      <div className="nx-wallet-dialog-body">
        {stage.kind === "preparing" && <p className="nx-wallet-lede"><LoaderCircle className="nx-spin" size={16}/> Getting the latest price…</p>}

        {stage.kind === "submitting" && <p className="nx-wallet-lede"><LoaderCircle className="nx-spin" size={16}/> Waiting for confirmation…</p>}
        {stage.kind === "done" && <>
          <p className="nx-wallet-lede"><CheckCircle2 size={18}/> Confirmed on Stellar.</p>
          <a className="nx-wallet-link" href={`https://stellar.expert/explorer/public/tx/${stage.hash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={11}/></a>
          <button type="button" className="nx-wallet-primary" onClick={onClose}>Done</button>
        </>}
        {stage.kind === "pending" && <>
          <p className="nx-wallet-lede">Submitted but not confirmed yet. Check your activity before trying again.</p>
          <a className="nx-wallet-link" href={`https://stellar.expert/explorer/public/tx/${stage.hash}`} target="_blank" rel="noreferrer">Check status <ExternalLink size={11}/></a>
        </>}
        {stage.kind === "error" && <>
          <p className="nx-wallet-error" role="alert">{stage.message}</p>
          <button type="button" className="nx-wallet-primary" onClick={onClose}>Close</button>
        </>}
      </div>
    </section>
  </div>;
}

export { loadQuote };
