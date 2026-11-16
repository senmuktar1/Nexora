"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, LoaderCircle, X } from "lucide-react";
import { useStellarWallet } from "@/components/wallet/WalletProvider";
import { explorerTx, submitSigned } from "@/lib/stellar/client";
import { blendIntent, blendSubmitArgs, toUnits, type BlendAction } from "@/lib/stellar/blend-requests";
import { guardMessage, TxGuardError } from "@/lib/stellar/tx-guard";

const TITLES: Record<BlendAction, string> = { supply: "Supply", withdraw: "Withdraw", borrow: "Borrow", repay: "Repay" };

function buildError(status: number): string {
  if (status === 422) return "This action would fail with your current position. Check the amount.";
  if (status === 503) return "Lending is temporarily unavailable.";
  if (status === 403 || status === 404 || status === 409) return "This market isn't available right now.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  return "Network is unavailable. Try again shortly.";
}

type Stage = { kind: "preparing" } | { kind: "approving" } | { kind: "submitting" } | { kind: "done"; hash: string } | { kind: "pending"; hash: string } | { kind: "error"; message: string };

/** Build (server, simulated) → verify args (client) → approve → sign → submit → confirm. */
export default function LendFlow({ poolId, asset, decimals, symbol, action, amount, onClose }: {
  poolId: string; asset: string; decimals: number; symbol: string; action: BlendAction; amount: string; onClose: (changed: boolean) => void;
}) {
  const { requestWallet, signTransaction } = useStellarWallet();
  const [stage, setStage] = useState<Stage>({ kind: "preparing" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const me = await requestWallet();
      if (!me) { onClose(false); return; }
      const units = toUnits(amount, decimals);
      if (units === null || units <= 0n) { setStage({ kind: "error", message: "Check the amount." }); return; }
      let args: string[];
      try { args = blendSubmitArgs(poolId, me, action, asset, units); } catch { setStage({ kind: "error", message: "Check the amount." }); return; }
      let xdr: string;
      try {
        const response = await fetch("/api/stellar/blend/build", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, poolId, asset, wallet: me, units: units.toString() }) });
        const data = await response.json().catch(() => null);
        if (!response.ok || typeof data?.xdr !== "string") { setStage({ kind: "error", message: buildError(response.status) }); return; }
        xdr = data.xdr;
      } catch {
        setStage({ kind: "error", message: "Network is unavailable. Try again shortly." });
        return;
      }
      setStage({ kind: "approving" });
      let signed: string;
      try {
        signed = await signTransaction(xdr, blendIntent(poolId, args), { title: `Approve ${TITLES[action].toLowerCase()}`, estimates: [[TITLES[action], `${amount} ${symbol}`]] });
      } catch (e) {
        if (e instanceof TxGuardError) setStage({ kind: "error", message: guardMessage(e) }); else onClose(false);
        return;
      }
      setStage({ kind: "submitting" });
      const outcome = await submitSigned(signed);
      if (outcome.status === "confirmed") setStage({ kind: "done", hash: outcome.hash });
      else if (outcome.status === "pending") setStage({ kind: "pending", hash: outcome.hash });
      else setStage({ kind: "error", message: outcome.message });
    })();
  }, [poolId, asset, decimals, symbol, action, amount, onClose, requestWallet, signTransaction]);

  if (stage.kind === "approving") return null;
  const busy = stage.kind === "preparing" || stage.kind === "submitting";
  return <div className="nx-command-overlay nx-wallet-overlay" role="presentation">
    <section className="nx-wallet-dialog" role="dialog" aria-modal="true" aria-label={TITLES[action]}>
      <header className="nx-wallet-dialog-head"><span/><strong>{TITLES[action]} {symbol}</strong>
        <button type="button" className="nx-wallet-dialog-icon" aria-label="Close" disabled={busy} onClick={() => onClose(stage.kind === "done")}><X size={16}/></button></header>
      <div className="nx-wallet-dialog-body">
        {stage.kind === "preparing" && <p className="nx-wallet-lede"><LoaderCircle className="nx-spin" size={16}/> Simulating…</p>}
        {stage.kind === "submitting" && <p className="nx-wallet-lede"><LoaderCircle className="nx-spin" size={16}/> Waiting for confirmation…</p>}
        {stage.kind === "done" && <>
          <p className="nx-wallet-lede"><CheckCircle2 size={18}/> Confirmed on Stellar.</p>
          <Link className="nx-wallet-link" href={`/receipt/${stage.hash}`}>View receipt</Link>
          <button type="button" className="nx-wallet-primary" onClick={() => onClose(true)}>Done</button>
        </>}
        {stage.kind === "pending" && <p className="nx-wallet-lede">Submitted but not confirmed yet. <a href={explorerTx(stage.hash)} target="_blank" rel="noreferrer">Check status</a></p>}
        {stage.kind === "error" && <>
          <p className="nx-wallet-error" role="alert">{stage.message}</p>
          <button type="button" className="nx-wallet-primary" onClick={() => onClose(false)}>Close</button>
        </>}
      </div>
    </section>
  </div>;
}
