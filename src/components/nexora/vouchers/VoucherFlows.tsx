"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Check, CheckCircle2, Copy, ExternalLink, LoaderCircle, QrCode, RotateCcw, Wallet, X } from "lucide-react";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { useStellarWallet } from "@/components/wallet/WalletProvider";
import { ClientError, explorerTx, hashOf, loadAccount, loadFeePerOperation, submitSigned } from "@/lib/stellar/client";
import { guardMessage, TxGuardError, type AssetId } from "@/lib/stellar/tx-guard";
import {
  buildCreateVouchers, buildRedeem, buildRefund, decodeVoucherLink, encodeVoucherLink, voucherExpiry,
  VoucherError, type ClaimableBalance, type VoucherLink
} from "@/lib/stellar/voucher";

export type StoredVoucher = {
  secret: string;
  publicKey: string;
  balanceId: string;
  amount: string;
  asset: AssetId;
  expiry: number;
  unlockAt: number | null;
  message: string;
  theme: string;
  txHash: string;
  createdAt: string;
  state: "submitted" | "confirmed" | "failed";
};

const assetCode = (id: AssetId) => id === "native" ? "XLM" : id.split(":")[0];
const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-6)}`;
const when = (epoch: number) => new Date(epoch * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export function voucherUrl(v: Pick<StoredVoucher, "secret" | "balanceId" | "message" | "theme">) {
  const base = encodeVoucherLink(window.location.origin, { secret: v.secret, balanceId: v.balanceId });
  const extra = new URLSearchParams();
  if (v.message) extra.set("m", v.message);
  if (v.theme) extra.set("t", v.theme);
  const tail = extra.toString();
  return tail ? `${base}&${tail}` : base;
}

function errorText(error: unknown): string {
  if (error instanceof TxGuardError) return guardMessage(error);
  if (error instanceof ClientError) return error.code === "inactive" ? "Your account isn't active yet. Fund it with XLM first." : "Network is unavailable. Try again shortly.";
  if (error instanceof VoucherError) {
    switch (error.code) {
      case "insufficient_balance": return "Insufficient balance after network reserves and fees.";
      case "invalid_expiry": return "Choose an unlock time before the expiry.";
      case "invalid_amount": return "Check the amount.";
      case "too_many_cards": return "Choose between 1 and 50 cards.";
      case "expired": return "This voucher has expired.";
      case "not_unlocked": return "This voucher can't be claimed yet.";
      case "not_expired": return "Vouchers can be refunded after they expire.";
      case "invalid_link": return "This voucher link isn't valid.";
      default: return "This voucher can't be claimed.";
    }
  }
  return "Something went wrong. Try again.";
}

function Overlay({ title, onClose, busy, children }: { title: string; onClose: () => void; busy: boolean; children: React.ReactNode }) {
  return <div className="nx-command-overlay nx-wallet-overlay" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section className="nx-wallet-dialog nx-voucher-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <header className="nx-wallet-dialog-head"><span/><strong>{title}</strong><button type="button" className="nx-wallet-dialog-icon" aria-label="Close" onClick={onClose} disabled={busy}><X size={16}/></button></header>
      <div className="nx-wallet-dialog-body">{children}</div>
    </section>
  </div>;
}

// ---------------- share ----------------

export function VoucherShare({ voucher }: { voucher: Pick<StoredVoucher, "secret" | "balanceId" | "message" | "theme" | "amount" | "asset"> }) {
  const url = voucherUrl(voucher);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  useEffect(() => {
    if (!showQr) return;
    let cancelled = false;
    QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: "M" }).then(d => { if (!cancelled) setQr(d); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [url, showQr]);
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  }
  return <div className="nx-voucher-share">
    <div className="nx-voucher-share-row">
      <strong>{voucher.amount} {assetCode(voucher.asset)}</strong>
      <div>
        <button type="button" onClick={() => void copy()}>{copied ? <Check size={13}/> : <Copy size={13}/>}{copied ? "Copied" : "Copy link"}</button>
        <button type="button" onClick={() => setShowQr(v => !v)}><QrCode size={13}/>QR</button>
      </div>
    </div>
    {/* eslint-disable-next-line @next/next/no-img-element -- locally generated data: URL, nothing to optimise */}
    {showQr && qr && <img className="nx-voucher-qr" src={qr} alt="Voucher QR code" width={240} height={240}/>}
  </div>;
}

// ---------------- create ----------------

type CreateStage =
  | { kind: "preparing" }
  | { kind: "approving" }
  | { kind: "submitting" }
  | { kind: "done"; hash: string; cards: StoredVoucher[] }
  | { kind: "pending"; hash: string }
  | { kind: "error"; message: string };

export function VoucherCreateFlow({ asset, amounts, expiry, unlockAt, message, theme, onClose }: {
  asset: AssetId; amounts: string[]; expiry: number; unlockAt: number | null; message: string; theme: string; onClose: () => void;
}) {
  const { signTransaction, saveRecord, requestWallet } = useStellarWallet();
  const [stage, setStage] = useState<CreateStage>({ kind: "preparing" });
  const started = useRef(false);
  const signRef = useRef(signTransaction);
  const saveRef = useRef(saveRecord);
  useEffect(() => { signRef.current = signTransaction; saveRef.current = saveRecord; }, [signTransaction, saveRecord]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const me = await requestWallet();
        if (!me) { onClose(); return; }
        const [account, fee] = await Promise.all([loadAccount(me), loadFeePerOperation()]);
        const plan = buildCreateVouchers({ account, asset, amounts, expiry, unlockAt, feePerOperation: fee });
        setStage({ kind: "approving" });
        let signed: string;
        try {
          signed = await signRef.current(plan.xdr, plan.intent, {
            title: amounts.length > 1 ? `Approve ${amounts.length} vouchers` : "Approve voucher",
            estimates: [["Total", `${plan.total} ${assetCode(asset)}`], ["Refundable reserve", `${plan.reserveLocked} XLM`]]
          });
        } catch (error) {
          if (error instanceof TxGuardError) setStage({ kind: "error", message: guardMessage(error) }); else onClose();
          return;
        }
        const createdAt = new Date().toISOString();
        const txHash = hashOf(signed);
        const records: StoredVoucher[] = plan.cards.map(c => ({ ...c, asset, expiry, unlockAt, message, theme, txHash, createdAt, state: "submitted" }));
        // Persist links (encrypted) BEFORE submitting so they survive a closed tab.
        for (const r of records) await saveRef.current(`voucher:${r.balanceId}`, r);
        setStage({ kind: "submitting" });
        const outcome = await submitSigned(signed);
        const state = outcome.status === "confirmed" ? "confirmed" : outcome.status === "failed" ? "failed" : "submitted";
        for (const r of records) await saveRef.current(`voucher:${r.balanceId}`, { ...r, state });
        if (outcome.status === "confirmed") setStage({ kind: "done", hash: outcome.hash, cards: records.map(r => ({ ...r, state })) });
        else if (outcome.status === "pending") setStage({ kind: "pending", hash: outcome.hash });
        else setStage({ kind: "error", message: outcome.message });
      } catch (error) {
        setStage({ kind: "error", message: errorText(error) });
      }
    })();
  }, [asset, amounts, expiry, unlockAt, message, theme, onClose, requestWallet]);

  if (stage.kind === "approving") return null;
  const busy = stage.kind === "preparing" || stage.kind === "submitting";
  return <Overlay title={stage.kind === "done" ? "Vouchers ready" : "Create vouchers"} onClose={onClose} busy={busy}>
    {stage.kind === "preparing" && <p className="nx-wallet-lede"><LoaderCircle className="nx-spin" size={16}/> Preparing…</p>}
    {stage.kind === "submitting" && <p className="nx-wallet-lede"><LoaderCircle className="nx-spin" size={16}/> Waiting for confirmation…</p>}
    {stage.kind === "done" && <>
      <p className="nx-wallet-lede"><CheckCircle2 size={18}/> Confirmed on Stellar. Share each link with one recipient.</p>
      <div className="nx-voucher-share-list">{stage.cards.map(c => <VoucherShare key={c.balanceId} voucher={c}/>)}</div>
      <p className="nx-voucher-share-note">Anyone with a link can claim that voucher. Links are saved, encrypted, under My Cards on this device.</p>
      <Link className="nx-wallet-link" href={`/receipt/${stage.hash}`}>View receipt</Link>
      <button type="button" className="nx-wallet-primary" onClick={onClose}>Done</button>
    </>}
    {stage.kind === "pending" && <>
      <p className="nx-wallet-lede">Submitted but not confirmed yet. Check My Cards shortly.</p>
      <a className="nx-wallet-link" href={explorerTx(stage.hash)} target="_blank" rel="noreferrer">Check status <ExternalLink size={11}/></a>
    </>}
    {stage.kind === "error" && <>
      <p className="nx-wallet-error" role="alert">{stage.message}</p>
      <button type="button" className="nx-wallet-primary" onClick={onClose}>Close</button>
    </>}
  </Overlay>;
}

// ---------------- redeem ----------------

type Loaded = { link: VoucherLink; balance: ClaimableBalance; expiry: number; unlockAt: number | null; message: string };
type RedeemState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "loaded"; v: Loaded }
  | { kind: "gone" }
  | { kind: "redeeming"; v: Loaded }
  | { kind: "done"; hash: string; v: Loaded }
  | { kind: "pending"; hash: string }
  | { kind: "error"; message: string; v?: Loaded };

export function VoucherRedeem({ initialLink }: { initialLink: string }) {
  const { address, requestWallet, signTransaction } = useStellarWallet();
  const [input, setInput] = useState(initialLink);
  const [state, setState] = useState<RedeemState>({ kind: "idle" });
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 15_000);
    return () => window.clearInterval(t);
  }, []);

  const check = useCallback(async (raw: string) => {
    let link: VoucherLink;
    try { link = decodeVoucherLink(raw); } catch { setState({ kind: "error", message: "This voucher link isn't valid." }); return; }
    const fragment = raw.includes("#") ? raw.slice(raw.indexOf("#") + 1) : raw;
    const message = (new URLSearchParams(fragment).get("m") ?? "").slice(0, 280);
    setState({ kind: "checking" });
    try {
      const response = await fetch(`/api/stellar/claimable-balances?id=${link.balanceId}`, { cache: "no-store" });
      if (!response.ok) throw new ClientError("unavailable");
      const data = await response.json();
      if (data.status === "not_found") { setState({ kind: "gone" }); return; }
      const balance = data.balance as ClaimableBalance;
      const shape = voucherExpiry(balance, Keypair.fromSecret(link.secret).publicKey());
      if (!shape) { setState({ kind: "error", message: "This voucher can't be claimed with this link." }); return; }
      setState({ kind: "loaded", v: { link, balance, expiry: shape.expiry, unlockAt: shape.unlockAt, message } });
    } catch (error) {
      setState({ kind: "error", message: errorText(error) });
    }
  }, []);

  useEffect(() => {
    if (!initialLink) return;
    const frame = window.requestAnimationFrame(() => void check(initialLink));
    return () => window.cancelAnimationFrame(frame);
  }, [initialLink, check]);

  async function redeem(v: Loaded) {
    const me = await requestWallet();
    if (!me) return;
    setState({ kind: "redeeming", v });
    try {
      const [account, fee] = await Promise.all([loadAccount(me), loadFeePerOperation()]);
      const plan = buildRedeem({ recipient: account, link: v.link, balance: v.balance, feePerOperation: fee });
      let signed: string;
      try {
        signed = await signTransaction(plan.xdr, plan.intent, { title: "Approve redemption", estimates: [["You receive", `${plan.amount} ${assetCode(plan.asset)}`]] });
      } catch (error) {
        setState(error instanceof TxGuardError ? { kind: "error", message: guardMessage(error), v } : { kind: "loaded", v });
        return;
      }
      // Co-sign with the voucher key from the link (the claimant), after the wallet approved.
      const tx = TransactionBuilder.fromXDR(signed, Networks.PUBLIC);
      tx.sign(Keypair.fromSecret(v.link.secret));
      const outcome = await submitSigned(tx.toEnvelope().toXDR("base64"));
      if (outcome.status === "confirmed") {
        window.history.replaceState(null, "", window.location.pathname);
        setState({ kind: "done", hash: outcome.hash, v });
      } else if (outcome.status === "pending") setState({ kind: "pending", hash: outcome.hash });
      else setState({ kind: "error", message: outcome.message, v });
    } catch (error) {
      setState({ kind: "error", message: errorText(error), v });
    }
  }

  const v = state.kind === "loaded" || state.kind === "redeeming" || state.kind === "done" ? state.v : state.kind === "error" ? state.v : undefined;

  return <div className="nx-panel nx-voucher-form-panel">
    <div><div className="nx-panel-kicker">CLAIM A STELLAR VOUCHER</div><h2>Redeem a gift</h2><p>Paste the voucher link you received.</p></div>
    {!v && <>
      <label className="nx-voucher-field">Voucher link<input value={input} onChange={e => setInput(e.target.value)} placeholder="https://…/redeem#k=…" autoComplete="off" spellCheck={false}/></label>
      <button className="nx-primary-button nx-voucher-wide-button" type="button" disabled={!input.trim() || state.kind === "checking"} onClick={() => void check(input)}>{state.kind === "checking" ? "Checking…" : "Check voucher"}</button>
    </>}
    {state.kind === "gone" && <p className="nx-wallet-error" role="alert">This voucher has already been claimed or refunded.</p>}
    {v && <>
      <div className="nx-voucher-review-list">
        <div><span>Amount</span><strong>{v.balance.amount.replace(/\.?0+$/, "")} {assetCode(v.balance.asset)}</strong></div>
        {v.balance.asset !== "native" && <div><span>Asset issuer</span><strong>{short(v.balance.asset.split(":")[1])}</strong></div>}
        {v.unlockAt && <div><span>Claimable from</span><strong>{when(v.unlockAt)}</strong></div>}
        <div><span>Expires</span><strong>{when(v.expiry)}</strong></div>
      </div>
      {v.message && <blockquote className="nx-voucher-review-message">“{v.message}”</blockquote>}
      {state.kind === "done" ? <>
        <p className="nx-wallet-lede"><CheckCircle2 size={18}/> Redeemed to your wallet.</p>
        <Link className="nx-wallet-link" href={`/receipt/${state.hash}`}>View receipt</Link>
      </> : !address ? <button type="button" className="nx-primary-button nx-voucher-wide-button" onClick={() => void requestWallet()}>Set up wallet to redeem <Wallet size={14}/></button>
        : <button type="button" className="nx-primary-button nx-voucher-wide-button" disabled={state.kind === "redeeming" || nowSec >= v.expiry || (v.unlockAt !== null && nowSec < v.unlockAt)} onClick={() => void redeem(v)}>
          {state.kind === "redeeming" ? "Redeeming…" : nowSec >= v.expiry ? "Expired" : v.unlockAt !== null && nowSec < v.unlockAt ? "Not yet claimable" : "Redeem to my wallet"}
        </button>}
    </>}
    {state.kind === "pending" && <p className="nx-wallet-lede">Submitted but not confirmed yet. <a href={explorerTx(state.hash)} target="_blank" rel="noreferrer">Check status</a></p>}
    {state.kind === "error" && <p className="nx-wallet-error" role="alert">{state.message}</p>}
  </div>;
}

// ---------------- my cards ----------------

type Row = { balanceId: string; amount: string; asset: AssetId; expiry: number | null; unlockAt: number | null; status: "unclaimed" | "locked" | "refundable" | "redeemed" | "pending" | "failed"; record?: StoredVoucher; balance?: ClaimableBalance };

export function VoucherMine({ onCreate }: { onCreate: () => void }) {
  const { address, unlocked, requestWallet, loadRecords, signTransaction } = useStellarWallet();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linksLoaded, setLinksLoaded] = useState(false);
  const [refund, setRefund] = useState<{ busy: boolean; message?: string; hash?: string } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/stellar/claimable-balances?claimant=${address}`, { cache: "no-store" });
        if (!response.ok) throw new ClientError("unavailable");
        const open = ((await response.json()).balances ?? []) as ClaimableBalance[];
        const records = unlocked ? (await loadRecords<StoredVoucher>("voucher:")).map(r => r.value) : [];
        if (cancelled) return;
        const nowSec = Math.floor(Date.now() / 1000);
        const byId = new Map(open.map(b => [b.id, b]));
        const out: Row[] = [];
        for (const b of open) {
          const creatorSide = b.claimants.find(c => c.destination === address);
          const other: ClaimableBalance["claimants"][number] | undefined = b.claimants.find(c => c.destination !== address);
          const shape: ReturnType<typeof voucherExpiry> = other ? voucherExpiry(b, other.destination) : null;
          if (!creatorSide || !shape || shape.creator !== address) continue; // not a NEXORA voucher created by me
          const rec = records.find(r => r.balanceId === b.id);
          out.push({ balanceId: b.id, amount: b.amount.replace(/\.?0+$/, ""), asset: b.asset, expiry: shape.expiry, unlockAt: shape.unlockAt, balance: b, record: rec,
            status: nowSec >= shape.expiry ? "refundable" : shape.unlockAt && nowSec < shape.unlockAt ? "locked" : "unclaimed" });
        }
        for (const r of records) {
          if (byId.has(r.balanceId)) continue;
          out.push({ balanceId: r.balanceId, amount: r.amount, asset: r.asset, expiry: r.expiry, unlockAt: r.unlockAt, record: r,
            status: r.state === "failed" ? "failed" : r.state === "submitted" ? "pending" : "redeemed" });
        }
        setRows(out.filter(r => r.status !== "failed").sort((a, b) => (b.record?.createdAt ?? "").localeCompare(a.record?.createdAt ?? "")));
        setLinksLoaded(unlocked);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(errorText(e));
      }
    })();
    return () => { cancelled = true; };
  }, [address, unlocked, loadRecords, reload]);

  async function refundExpired() {
    if (!address || !rows) return;
    const targets = rows.filter(r => r.status === "refundable" && r.balance).map(r => r.balance!).slice(0, 50);
    if (!targets.length) return;
    setRefund({ busy: true });
    try {
      const [account, fee] = await Promise.all([loadAccount(address), loadFeePerOperation()]);
      const plan = buildRefund({ account, balances: targets, feePerOperation: fee });
      let signed: string;
      try {
        signed = await signTransaction(plan.xdr, plan.intent, { title: "Approve refund" });
      } catch (e) {
        setRefund(e instanceof TxGuardError ? { busy: false, message: guardMessage(e) } : null);
        return;
      }
      const outcome = await submitSigned(signed);
      setRefund(outcome.status === "confirmed" ? { busy: false, hash: outcome.hash } : { busy: false, message: outcome.status === "failed" ? outcome.message : "Submitted but not confirmed yet." });
      setReload(x => x + 1);
    } catch (e) {
      setRefund({ busy: false, message: errorText(e) });
    }
  }

  if (!address) return <section className="nx-panel nx-voucher-mine">
    <span className="nx-voucher-mine-icon"><Wallet size={25}/></span>
    <div><div className="nx-panel-kicker">MY VOUCHERS</div><h2>Set up wallet to view your cards</h2><p>Create or import a wallet to create and track vouchers.</p></div>
    <button type="button" className="nx-primary-button" onClick={() => void requestWallet()}>Set up wallet <Wallet size={14}/></button>
  </section>;

  const refundable = rows?.filter(r => r.status === "refundable").length ?? 0;
  const label: Record<Row["status"], string> = { unclaimed: "Unclaimed", locked: "Not yet claimable", refundable: "Expired · refundable", redeemed: "Claimed or refunded", pending: "Confirming", failed: "Failed" };

  return <section className="nx-panel nx-voucher-mine-list">
    <div className="nx-voucher-mine-head">
      <div><div className="nx-panel-kicker">MY VOUCHERS</div><h2>Your vouchers</h2></div>
      <div className="nx-voucher-mine-actions">
        {!linksLoaded && <button type="button" className="nx-secondary-button" onClick={() => void requestWallet()}>Unlock to show links</button>}
        {refundable > 0 && <button type="button" className="nx-primary-button" disabled={refund?.busy} onClick={() => void refundExpired()}><RotateCcw size={14}/>{refund?.busy ? "Refunding…" : `Refund ${refundable} expired`}</button>}
      </div>
    </div>
    {refund?.hash && <p className="nx-wallet-lede"><CheckCircle2 size={16}/> Refund confirmed. <Link href={`/receipt/${refund.hash}`}>Receipt</Link></p>}
    {refund?.message && <p className="nx-wallet-error" role="alert">{refund.message}</p>}
    {error && <p className="nx-wallet-error" role="alert">{error}</p>}
    {!rows && !error && <p className="nx-wallet-lede"><LoaderCircle className="nx-spin" size={16}/> Loading…</p>}
    {rows && rows.length === 0 && <div className="nx-voucher-mine-empty"><p>No vouchers yet.</p><button type="button" className="nx-secondary-button" onClick={onCreate}>Create a voucher</button></div>}
    {rows && rows.length > 0 && <div className="nx-voucher-mine-rows">{rows.map(r => <article key={r.balanceId} className="nx-voucher-mine-row">
      <div><strong>{r.amount} {assetCode(r.asset)}</strong><small>{label[r.status]}{r.expiry ? ` · expires ${when(r.expiry)}` : ""}</small></div>
      {r.record && (r.status === "unclaimed" || r.status === "locked") && <VoucherShare voucher={r.record}/>}
      {r.record?.txHash && <Link href={`/receipt/${r.record.txHash}`} className="nx-voucher-mine-receipt">Receipt</Link>}
    </article>)}</div>}
  </section>;
}
