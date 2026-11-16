"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, LoaderCircle, X } from "lucide-react";
import { useStellarWallet } from "@/components/wallet/WalletProvider";
import { ClientError, explorerTx, loadAccount, submitSigned } from "@/lib/stellar/client";
import { buildDeployTx, buildUploadTx, loadTokenWasm, TokenError } from "@/lib/stellar/soroban-token";
import { guardMessage, TxGuardError } from "@/lib/stellar/tx-guard";
import type { LaunchRecord } from "./LaunchFlows";

export type SorobanLaunchConfig = { name: string; symbol: string; decimals: number; supplyUnits: bigint; supplyDisplay: string };

type Stage =
  | { kind: "working"; label: string }
  | { kind: "approving" }
  | { kind: "done"; contractId: string; hash: string }
  | { kind: "pending"; hash: string; step: "install" | "deploy" }
  | { kind: "error"; message: string };

class FlowStop extends Error { constructor(public readonly stage: Stage | null) { super("stop"); } }

function prepareError(status: number, step: "install" | "deploy") {
  if (status === 503) return "Smart-contract features are temporarily unavailable.";
  if (status === 422) return step === "install" ? "The token code couldn't be installed right now." : "This token can't be deployed with these settings. Check your XLM balance.";
  if (status === 409) return "The network fee is unusually high right now. Try again later.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  return "Network is unavailable. Try again shortly.";
}

/**
 * Soroban token deployment:
 *  1. (only if not yet on Mainnet) install the pinned NEXORA token code
 *  2. deploy a new contract from it with constructor (name, symbol, decimals, you, supply)
 * Each step: built locally → simulated by the server → verified by the guard → approved → signed → confirmed.
 */
export default function SorobanLaunchFlow({ config, onClose }: { config: SorobanLaunchConfig; onClose: () => void }) {
  const { requestWallet, signTransaction, saveRecord } = useStellarWallet();
  const [stage, setStage] = useState<Stage>({ kind: "working", label: "Preparing…" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function prepare(xdr: string, step: "install" | "deploy") {
      const r = await fetch("/api/stellar/soroban/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ xdr }) });
      const d = await r.json().catch(() => null);
      if (!r.ok || typeof d?.xdr !== "string") throw new FlowStop({ kind: "error", message: prepareError(r.status, step) });
      return d.xdr as string;
    }
    async function approveAndSubmit(xdr: string, intent: Parameters<typeof signTransaction>[1], title: string, step: "install" | "deploy", estimates?: [string, string][]) {
      setStage({ kind: "approving" });
      let signed: string;
      try { signed = await signTransaction(xdr, intent, { title, estimates }); }
      catch (e) { throw new FlowStop(e instanceof TxGuardError ? { kind: "error", message: guardMessage(e) } : null); }
      setStage({ kind: "working", label: "Waiting for confirmation…" });
      const outcome = await submitSigned(signed);
      if (outcome.status === "pending") throw new FlowStop({ kind: "pending", hash: outcome.hash, step });
      if (outcome.status === "failed") throw new FlowStop({ kind: "error", message: outcome.message });
      return outcome.hash;
    }

    (async () => {
      try {
        const me = await requestWallet();
        if (!me) { onClose(); return; }
        const wasm = await loadTokenWasm();
        const status = await fetch("/api/stellar/soroban/code-status", { cache: "no-store" });
        const sd = status.ok ? await status.json() : null;
        if (!sd || typeof sd.installed !== "boolean") throw new FlowStop({ kind: "error", message: prepareError(status.status, "install") });

        if (!sd.installed) {
          setStage({ kind: "working", label: "Preparing one-time code installation…" });
          const acct = await loadAccount(me);
          const up = buildUploadTx({ id: acct.id, sequence: acct.sequence }, wasm);
          const prepared = await prepare(up.xdr, "install");
          await approveAndSubmit(prepared, up.intent, "Approve token code installation", "install", [["Step", "1 of 2 — installs the NEXORA token code on Stellar (once for everyone)"]]);
        }

        setStage({ kind: "working", label: "Preparing deployment…" });
        const acct = await loadAccount(me);
        const salt = new Uint8Array(32);
        crypto.getRandomValues(salt);
        const dep = buildDeployTx({ id: acct.id, sequence: acct.sequence }, { name: config.name, symbol: config.symbol, decimals: config.decimals, recipient: me, supplyUnits: config.supplyUnits }, salt);
        const prepared = await prepare(dep.xdr, "deploy");
        const hash = await approveAndSubmit(prepared, dep.intent, `Approve ${config.symbol} deployment`, "deploy", [["New token", `${config.name} (${config.symbol})`]]);

        const record: LaunchRecord = { code: config.symbol, issuer: dep.contractId, issuerSecret: null, name: config.name, totalSupply: config.supplyDisplay,
          fixedSupply: true, homeDomain: "", toml: "", txHash: hash, createdAt: new Date().toISOString(), state: "confirmed", kind: "soroban" };
        await saveRecord(`launch:${dep.contractId}`, record).catch(() => undefined);
        setStage({ kind: "done", contractId: dep.contractId, hash });
      } catch (e) {
        if (e instanceof FlowStop) { if (e.stage) setStage(e.stage); else onClose(); return; }
        if (e instanceof TokenError) { setStage({ kind: "error", message: e.code === "wasm_mismatch" ? "The token code failed its integrity check, so nothing was signed." : "Check the token name, symbol, decimals and supply." }); return; }
        if (e instanceof ClientError) { setStage({ kind: "error", message: e.code === "inactive" ? "Your account isn't active yet. Fund it with XLM first." : "Network is unavailable. Try again shortly." }); return; }
        setStage({ kind: "error", message: "Something went wrong. Try again." });
      }
    })();
  }, [config, onClose, requestWallet, signTransaction, saveRecord]);

  if (stage.kind === "approving") return null;
  const busy = stage.kind === "working";
  return <div className="nx-command-overlay nx-wallet-overlay" role="presentation">
    <section className="nx-wallet-dialog" role="dialog" aria-modal="true" aria-label="Deploy token">
      <header className="nx-wallet-dialog-head"><span/><strong>{stage.kind === "done" ? `${config.symbol} is live` : "Deploy token"}</strong>
        <button type="button" className="nx-wallet-dialog-icon" aria-label="Close" onClick={onClose} disabled={busy}><X size={16}/></button></header>
      <div className="nx-wallet-dialog-body">
        {stage.kind === "working" && <p className="nx-wallet-lede"><LoaderCircle className="nx-spin" size={16}/> {stage.label}</p>}
        {stage.kind === "done" && <>
          <p className="nx-wallet-lede"><CheckCircle2 size={18}/> Deployed and confirmed on Stellar.</p>
          <div className="nx-wallet-field-label">Token contract</div>
          <code className="nx-wallet-code">{stage.contractId}</code>
          <a className="nx-wallet-link" href={`https://stellar.expert/explorer/public/contract/${stage.contractId}`} target="_blank" rel="noreferrer">View contract <ExternalLink size={11}/></a>
          <Link className="nx-wallet-link" href={`/receipt/${stage.hash}`}>View receipt</Link>
          <button type="button" className="nx-wallet-primary" onClick={onClose}>Done</button>
        </>}
        {stage.kind === "pending" && <p className="nx-wallet-lede">{stage.step === "install" ? "Code installation" : "Deployment"} submitted but not confirmed yet. <a href={explorerTx(stage.hash)} target="_blank" rel="noreferrer">Check status</a> before trying again.</p>}
        {stage.kind === "error" && <>
          <p className="nx-wallet-error" role="alert">{stage.message}</p>
          <button type="button" className="nx-wallet-primary" onClick={onClose}>Close</button>
        </>}
      </div>
    </section>
  </div>;
}
