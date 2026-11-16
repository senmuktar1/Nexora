"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { useStellarWallet } from "@/components/wallet/WalletProvider";
import { explorerTx, submitSigned } from "@/lib/stellar/client";
import { defindexDepositArgs, defindexIntent, defindexWithdrawArgs, withSlippage } from "@/lib/stellar/defindex-requests";
import { formatUnits, toUnits } from "@/lib/stellar/blend-requests";
import { guardMessage, TxGuardError } from "@/lib/stellar/tx-guard";

type Asset = { address: string; symbol: string | null; decimals: number | null };
type Position = { assets: Asset[]; totalShares: string; userShares: string | null; userAmounts: string[] | null };
type Status = { kind: "idle" } | { kind: "busy"; label: string } | { kind: "done"; hash: string; action: string } | { kind: "pending"; hash: string } | { kind: "error"; message: string };

const SLIPPAGES = [50, 100, 300];

function buildError(status: number) {
  if (status === 422) return "This action would fail. Check the amount and your balance.";
  if (status === 503) return "Vaults are temporarily unavailable.";
  if (status === 404) return "This vault isn't available.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  return "Network is unavailable. Try again shortly.";
}

/** On-chain DeFindex vault position + deposit/withdraw (shares) with client-verified call arguments. */
export default function DefindexActions({ vault }: { vault: string }) {
  const { address, requestWallet, signTransaction } = useStellarWallet();
  const [position, setPosition] = useState<Position | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amounts, setAmounts] = useState<string[]>([]);
  const [withdrawPct, setWithdrawPct] = useState(100);
  const [slippage, setSlippage] = useState(50);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams({ vault });
    if (address) q.set("wallet", address);
    fetch(`/api/stellar/defindex/position?${q}`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error("x")))
      .then((d: Position) => { if (!cancelled) { setPosition(d); setAmounts(a => a.length === d.assets.length ? a : d.assets.map(() => "")); setLoadState("ready"); } })
      .catch(() => { if (!cancelled) setLoadState("unavailable"); });
    return () => { cancelled = true; };
  }, [vault, address, reload]);

  const decimalsOk = position?.assets.every(a => a.decimals !== null) ?? false;
  const fmt = (units: string, i: number) => position?.assets[i]?.decimals != null ? formatUnits(BigInt(units), position.assets[i].decimals!) : units;
  const userShares = position?.userShares ? BigInt(position.userShares) : 0n;

  const run = useCallback(async (action: "deposit" | "withdraw") => {
    if (!position) return;
    const me = await requestWallet();
    if (!me) return;
    setStatus({ kind: "busy", label: "Simulating…" });
    try {
      let args: string[], body: Record<string, unknown>, estimate: string;
      if (action === "deposit") {
        const desired = position.assets.map((a, i) => amounts[i]?.trim() ? toUnits(amounts[i], a.decimals ?? -1) : 0n);
        if (desired.some(d => d === null) || desired.every(d => d === 0n)) { setStatus({ kind: "error", message: "Check the amount." }); return; }
        const mins = withSlippage(desired as bigint[], slippage);
        args = defindexDepositArgs(me, desired as bigint[], mins, true);
        body = { action, vault, wallet: me, amounts: (desired as bigint[]).map(String), amountsMin: mins.map(String) };
        estimate = position.assets.map((a, i) => `${fmt(String(desired[i]), i)} ${a.symbol ?? ""}`.trim()).join(" + ");
      } else {
        const shares = (userShares * BigInt(withdrawPct)) / 100n;
        if (shares <= 0n) { setStatus({ kind: "error", message: "You have no shares in this vault." }); return; }
        const r = await fetch(`/api/stellar/defindex/position?vault=${vault}&shares=${shares}`, { cache: "no-store" });
        const d = r.ok ? await r.json() : null;
        const expected: bigint[] | null = Array.isArray(d?.amountsForShares) ? d.amountsForShares.map((x: string) => BigInt(x)) : null;
        if (!expected || expected.length !== position.assets.length) { setStatus({ kind: "error", message: buildError(r.status) }); return; }
        const mins = withSlippage(expected, slippage);
        args = defindexWithdrawArgs(me, shares, mins);
        body = { action, vault, wallet: me, shares: String(shares), minAmountsOut: mins.map(String) };
        estimate = position.assets.map((a, i) => `${fmt(String(expected[i]), i)} ${a.symbol ?? ""}`.trim()).join(" + ");
      }
      const response = await fetch("/api/stellar/defindex/build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => null);
      if (!response.ok || typeof data?.xdr !== "string") { setStatus({ kind: "error", message: buildError(response.status) }); return; }
      setStatus({ kind: "busy", label: "Waiting for approval…" });
      let signed: string;
      try {
        signed = await signTransaction(data.xdr, defindexIntent(vault, action, args), {
          title: action === "deposit" ? "Approve vault deposit" : "Approve vault withdrawal",
          estimates: [[action === "deposit" ? "You deposit" : "You receive (est.)", estimate], ["Slippage limit", `${slippage / 100}%`]]
        });
      } catch (e) {
        setStatus(e instanceof TxGuardError ? { kind: "error", message: guardMessage(e) } : { kind: "idle" });
        return;
      }
      setStatus({ kind: "busy", label: "Waiting for confirmation…" });
      const outcome = await submitSigned(signed);
      if (outcome.status === "confirmed") { setStatus({ kind: "done", hash: outcome.hash, action }); setReload(x => x + 1); }
      else if (outcome.status === "pending") setStatus({ kind: "pending", hash: outcome.hash });
      else setStatus({ kind: "error", message: outcome.message });
    } catch {
      setStatus({ kind: "error", message: "Network is unavailable. Try again shortly." });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fmt derives from position
  }, [position, amounts, slippage, withdrawPct, userShares, vault, requestWallet, signTransaction]);

  if (loadState === "loading") return <div className="nx-defindex-actions"><p className="nx-wallet-lede"><LoaderCircle className="nx-spin" size={15}/> Loading position…</p></div>;
  if (loadState === "unavailable" || !position) return <div className="nx-defindex-actions"><p className="nx-defindex-muted">Deposits and withdrawals for this vault are temporarily unavailable.</p></div>;
  const busy = status.kind === "busy";

  return <div className="nx-defindex-actions">
    <div className="nx-defindex-position">
      <div><small>Your shares</small><strong>{position.userShares === null ? "—" : position.userShares}</strong></div>
      <div><small>Your balance</small><strong>{position.userAmounts ? position.userAmounts.map((u, i) => `${fmt(u, i)} ${position.assets[i].symbol ?? ""}`).join(" + ") : "—"}</strong></div>
    </div>
    <div className="nx-defindex-tabs" role="tablist">
      {(["deposit", "withdraw"] as const).map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => { setTab(t); setStatus({ kind: "idle" }); }}>{t === "deposit" ? "Deposit" : "Withdraw"}</button>)}
    </div>
    {tab === "deposit" ? position.assets.map((a, i) => <label key={a.address} className="nx-defindex-field">{a.symbol ?? "Asset"} amount
      <input inputMode="decimal" value={amounts[i] ?? ""} placeholder="0.00" onChange={e => setAmounts(v => v.map((x, j) => j === i ? e.target.value.replace(/[^0-9.]/g, "") : x))} disabled={!decimalsOk}/>
    </label>) : <div className="nx-defindex-field">Amount to withdraw
      <div className="nx-voucher-choice-row">{[25, 50, 100].map(p => <button key={p} type="button" className={withdrawPct === p ? "active" : ""} onClick={() => setWithdrawPct(p)}>{p}%</button>)}</div>
    </div>}
    <div className="nx-defindex-field">Slippage limit
      <div className="nx-voucher-choice-row">{SLIPPAGES.map(b => <button key={b} type="button" className={slippage === b ? "active" : ""} onClick={() => setSlippage(b)}>{b / 100}%</button>)}</div>
    </div>
    {status.kind === "error" && <p className="nx-wallet-error" role="alert">{status.message}</p>}
    {status.kind === "done" && <p className="nx-wallet-lede"><CheckCircle2 size={15}/> {status.action === "deposit" ? "Deposit" : "Withdrawal"} confirmed. <Link href={`/receipt/${status.hash}`}>Receipt</Link></p>}
    {status.kind === "pending" && <p className="nx-wallet-lede">Submitted but not confirmed yet. <a href={explorerTx(status.hash)} target="_blank" rel="noreferrer">Check status</a></p>}
    {!address ? <button type="button" className="nx-wallet-primary" onClick={() => void requestWallet()}>Set up wallet</button>
      : <button type="button" className="nx-wallet-primary" disabled={busy || (tab === "deposit" ? !decimalsOk || amounts.every(a => !a.trim()) : userShares <= 0n)} onClick={() => void run(tab)}>
        {busy ? <><LoaderCircle className="nx-spin" size={14}/> {status.label}</> : tab === "deposit" ? "Deposit" : "Withdraw"}
      </button>}
  </div>;
}
