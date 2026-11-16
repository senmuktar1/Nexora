"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, Copy, Eye, EyeOff, LoaderCircle, Rocket, X } from "lucide-react";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { useStellarWallet } from "@/components/wallet/WalletProvider";
import { ClientError, explorerTx, hashOf, loadAccount, loadFeePerOperation, submitSigned } from "@/lib/stellar/client";
import { buildClassicLaunch, buildStellarToml, LaunchError, type Allocation } from "@/lib/stellar/launch";
import { guardMessage, TxGuardError } from "@/lib/stellar/tx-guard";

export type LaunchRecord = {
  code: string;
  issuer: string;
  /** Only kept when the issuer is not locked (needed for future issuer actions). */
  issuerSecret: string | null;
  name: string;
  totalSupply: string;
  fixedSupply: boolean;
  homeDomain: string;
  toml: string;
  txHash: string;
  createdAt: string;
  state: "submitted" | "confirmed" | "failed";
  /** "soroban" = SEP-41 contract (issuer holds the contract ID); absent = classic asset. */
  kind?: "classic" | "soroban";
};

export type LaunchConfig = {
  code: string; name: string; description: string; totalSupply: string; homeDomain: string;
  authRequired: boolean; authRevocable: boolean; clawback: boolean; fixedSupply: boolean;
  allocations: Allocation[]; listing: { amount: string; priceXlm: string } | null;
  rwa: null | { anchorAssetType: string; anchorAsset: string; redemptionInstructions: string; attestationUrl: string };
};

const MESSAGES: Record<LaunchError["code"], string> = {
  invalid_code: "Use 1–12 letters or digits for the asset code.",
  invalid_supply: "Check the total supply.",
  invalid_domain: "Enter a valid home domain (e.g. example.com).",
  invalid_allocation: "Check allocation addresses and percentages.",
  allocation_over_100: "Allocations must total less than 100%.",
  clawback_requires_revocable: "Clawback requires revocable authorization.",
  auth_required_no_allocations: "Assets that require authorization can't include allocations or a DEX listing at launch.",
  invalid_listing: "Check the listing amount and price.",
  too_many_operations: "Too many allocations and vesting tranches for one transaction.",
  insufficient_balance: "Not enough XLM for reserves and fees.",
  invalid_fee: "Network is unavailable. Try again shortly."
};

function errorText(e: unknown) {
  if (e instanceof LaunchError) return MESSAGES[e.code];
  if (e instanceof TxGuardError) return guardMessage(e);
  if (e instanceof ClientError) return e.code === "inactive" ? "Your account isn't active yet. Fund it with XLM first." : "Network is unavailable. Try again shortly.";
  return "Something went wrong. Try again.";
}

function CopyBlock({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [shown, setShown] = useState(!secret);
  const [copied, setCopied] = useState(false);
  return <div className="nx-launch-copy">
    <div className="nx-wallet-field-label">{label}</div>
    <pre className={shown ? "nx-wallet-code" : "nx-wallet-code nx-wallet-masked"}>{shown ? value : "•".repeat(Math.min(56, value.length))}</pre>
    <div className="nx-wallet-secret-actions">
      {secret && <button type="button" onClick={() => setShown(v => !v)}>{shown ? <EyeOff size={13}/> : <Eye size={13}/>}{shown ? "Hide" : "Reveal"}</button>}
      <button type="button" onClick={() => void navigator.clipboard.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }).catch(() => undefined)}>{copied ? <Check size={13}/> : <Copy size={13}/>}{copied ? "Copied" : "Copy"}</button>
    </div>
  </div>;
}

type Stage =
  | { kind: "preparing" } | { kind: "approving" } | { kind: "submitting" }
  | { kind: "done"; record: LaunchRecord } | { kind: "pending"; hash: string } | { kind: "error"; message: string };

export function LaunchFlow({ config, onClose, onConfirmed }: { config: LaunchConfig; onClose: () => void; onConfirmed?: (record: LaunchRecord) => void }) {
  const { requestWallet, signTransaction, saveRecord } = useStellarWallet();
  const [stage, setStage] = useState<Stage>({ kind: "preparing" });
  const [backedUp, setBackedUp] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const me = await requestWallet();
        if (!me) { onClose(); return; }
        const [account, fee] = await Promise.all([loadAccount(me), loadFeePerOperation()]);
        const plan = buildClassicLaunch({ account, code: config.code, totalSupply: config.totalSupply, homeDomain: config.homeDomain,
          authRequired: config.authRequired, authRevocable: config.authRevocable, clawback: config.clawback, allocations: config.allocations,
          fixedSupply: config.fixedSupply, listing: config.listing, feePerOperation: fee });
        setStage({ kind: "approving" });
        let signed: string;
        try {
          signed = await signTransaction(plan.xdr, plan.intent, { title: `Approve launch of ${config.code}`, estimates: [["XLM required", `${plan.summary.xlmRequired} XLM`]] });
        } catch (e) {
          if (e instanceof TxGuardError) setStage({ kind: "error", message: guardMessage(e) }); else onClose();
          return;
        }
        // The new issuer co-signs its own operations (account creation is paid by the wallet).
        const tx = TransactionBuilder.fromXDR(signed, Networks.PUBLIC);
        tx.sign(Keypair.fromSecret(plan.issuerSecret));
        const envelope = tx.toEnvelope().toXDR("base64");
        const record: LaunchRecord = {
          code: config.code, issuer: plan.issuerPublic, issuerSecret: config.fixedSupply ? null : plan.issuerSecret,
          name: config.name, totalSupply: plan.summary.totalSupply, fixedSupply: config.fixedSupply, homeDomain: config.homeDomain,
          toml: buildStellarToml({ code: config.code, issuer: plan.issuerPublic, name: config.name, description: config.description, fixedSupply: config.fixedSupply,
            isAssetAnchored: !!config.rwa, anchorAssetType: config.rwa?.anchorAssetType, anchorAsset: config.rwa?.anchorAsset,
            redemptionInstructions: config.rwa?.redemptionInstructions, attestationUrl: config.rwa?.attestationUrl }),
          txHash: hashOf(envelope), createdAt: new Date().toISOString(), state: "submitted"
        };
        // Persist (encrypted) before submitting so the issuer key can't be lost to a closed tab.
        await saveRecord(`launch:${plan.issuerPublic}`, record);
        setStage({ kind: "submitting" });
        const outcome = await submitSigned(envelope);
        const final = { ...record, state: outcome.status === "confirmed" ? "confirmed" : outcome.status === "failed" ? "failed" : "submitted" } as LaunchRecord;
        await saveRecord(`launch:${plan.issuerPublic}`, final);
        if (outcome.status === "confirmed") { setStage({ kind: "done", record: final }); onConfirmed?.(final); }
        else if (outcome.status === "pending") setStage({ kind: "pending", hash: outcome.hash });
        else setStage({ kind: "error", message: outcome.message });
      } catch (e) {
        setStage({ kind: "error", message: errorText(e) });
      }
    })();
  }, [config, onClose, onConfirmed, requestWallet, signTransaction, saveRecord]);

  if (stage.kind === "approving") return null;
  const busy = stage.kind === "preparing" || stage.kind === "submitting";
  const needsBackup = stage.kind === "done" && !!stage.record.issuerSecret;

  return <div className="nx-command-overlay nx-wallet-overlay" role="presentation">
    <section className="nx-wallet-dialog nx-voucher-dialog" role="dialog" aria-modal="true" aria-label="Launch asset">
      <header className="nx-wallet-dialog-head"><span/><strong>{stage.kind === "done" ? `${stage.record.code} is live` : "Launch asset"}</strong>
        <button type="button" className="nx-wallet-dialog-icon" aria-label="Close" onClick={onClose} disabled={busy || (needsBackup && !backedUp)}><X size={16}/></button></header>
      <div className="nx-wallet-dialog-body">
        {stage.kind === "preparing" && <p className="nx-wallet-lede"><LoaderCircle className="nx-spin" size={16}/> Preparing…</p>}
        {stage.kind === "submitting" && <p className="nx-wallet-lede"><LoaderCircle className="nx-spin" size={16}/> Waiting for confirmation…</p>}
        {stage.kind === "done" && <>
          <p className="nx-wallet-lede"><CheckCircle2 size={18}/> Confirmed on Stellar.</p>
          <CopyBlock label="Asset" value={`${stage.record.code}:${stage.record.issuer}`}/>
          {stage.record.issuerSecret && <>
            <CopyBlock label="Issuer secret key" value={stage.record.issuerSecret} secret/>
            <p className="nx-wallet-warning">The issuer key controls minting and issuer settings. It’s saved encrypted on this device; also store a copy offline.</p>
            <label className="nx-wallet-check"><input type="checkbox" checked={backedUp} onChange={e => setBackedUp(e.target.checked)}/>I have saved the issuer secret key.</label>
          </>}
          {stage.record.homeDomain && <CopyBlock label={`Publish at https://${stage.record.homeDomain}/.well-known/stellar.toml`} value={stage.record.toml}/>}
          <Link className="nx-wallet-link" href={`/receipt/${stage.record.txHash}`}>View receipt</Link>
          <button type="button" className="nx-wallet-primary" disabled={needsBackup && !backedUp} onClick={onClose}>Done</button>
        </>}
        {stage.kind === "pending" && <p className="nx-wallet-lede">Submitted but not confirmed yet. <a href={explorerTx(stage.hash)} target="_blank" rel="noreferrer">Check status</a></p>}
        {stage.kind === "error" && <>
          <p className="nx-wallet-error" role="alert">{stage.message}</p>
          <button type="button" className="nx-wallet-primary" onClick={onClose}>Close</button>
        </>}
      </div>
    </section>
  </div>;
}

export function LaunchMine({ onCreate }: { onCreate: () => void }) {
  const { address, unlocked, requestWallet, loadRecords } = useStellarWallet();
  const [records, setRecords] = useState<LaunchRecord[] | null>(null);
  const [holders, setHolders] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!address || !unlocked) return;
    let cancelled = false;
    loadRecords<LaunchRecord>("launch:").then(rs => {
      if (cancelled) return;
      const list = rs.map(r => r.value).filter(r => r.state !== "failed").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setRecords(list);
      for (const r of list) {
        fetch(`/api/stellar/assets?network=mainnet&code=${encodeURIComponent(r.code)}`, { cache: "no-store" })
          .then(x => x.ok ? x.json() : null)
          .then(d => {
            const match = (d?.assets ?? []).find((a: { asset_issuer: string }) => a.asset_issuer === r.issuer);
            if (!cancelled && match) setHolders(h => ({ ...h, [r.issuer]: String(match.num_accounts ?? "—") }));
          }).catch(() => undefined);
      }
    }).catch(() => { if (!cancelled) setRecords([]); });
    return () => { cancelled = true; };
  }, [address, unlocked, loadRecords]);

  if (!address || !unlocked) return <section className="nx-launch-private-state"><div className="nx-launch-private-head"><span><Rocket size={18}/></span><div><strong>My launches</strong><small>Assets issued from this wallet</small></div></div>
    <p>{address ? "Unlock your wallet to view your launches." : "Set up a wallet to view the assets you issue."}</p>
    <button type="button" onClick={() => void requestWallet()}>{address ? "Unlock" : "Set up wallet"}</button></section>;

  return <section className="nx-launch-private-state">
    <div className="nx-launch-private-head"><span><Rocket size={18}/></span><div><strong>My launches</strong><small>Assets issued from this wallet</small></div></div>
    {!records && <p className="nx-wallet-lede"><LoaderCircle className="nx-spin" size={16}/> Loading…</p>}
    {records && records.length === 0 && <div className="nx-launch-private-empty"><Rocket size={23}/><strong>No launches yet</strong><button type="button" onClick={onCreate}>Create asset</button></div>}
    {records && records.length > 0 && <div className="nx-voucher-mine-rows">{records.map(r => <article key={r.issuer} className="nx-voucher-mine-row">
      <div><strong>{r.code} · {r.name}</strong><small>{r.kind === "soroban" ? "Soroban token" : r.state === "confirmed" ? "Issued" : "Confirming"} · supply {Number(r.totalSupply).toLocaleString()}{r.fixedSupply ? " (fixed)" : ""} · holders {holders[r.issuer] ?? "—"}</small></div>
      <div className="nx-launch-mine-links">{r.kind === "soroban" ? <a href={`https://stellar.expert/explorer/public/contract/${r.issuer}`} target="_blank" rel="noreferrer">Contract</a> : <Link href={`/explore/token/${r.code}-${r.issuer}`}>Asset</Link>}<Link href={`/receipt/${r.txHash}`}>Receipt</Link></div>
      {r.issuerSecret && <div className="nx-launch-mine-secret"><CopyBlock label="Issuer secret key" value={r.issuerSecret} secret/></div>}
    </article>)}</div>}
  </section>;
}
