"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { StrKey } from "@stellar/stellar-sdk";
import { useStellarWallet } from "@/components/wallet/WalletProvider";
import { ClientError, loadAccount, loadFeePerOperation, submitSigned } from "@/lib/stellar/client";
import { buildPayment, PaymentError } from "@/lib/stellar/payment";
import { guardMessage, TxGuardError } from "@/lib/stellar/tx-guard";
import { VOUCHER_ASSETS } from "@/lib/stellar/voucher";

const ASSETS = [VOUCHER_ASSETS.native, VOUCHER_ASSETS.usdc];
const MESSAGES: Record<PaymentError["code"], string> = {
  invalid_amount: "Enter a valid amount.",
  self: "You can't pay your own account.",
  insufficient_balance: "Insufficient balance after network reserves and fees.",
  no_trustline: "The recipient can't receive this asset yet.",
  inactive_needs_xlm: "This account isn't active yet. Send at least 1 XLM to activate it.",
  min_create: "This account isn't active yet. Send at least 1 XLM to activate it.",
  memo_too_long: "Memo must be 28 bytes or fewer.",
  invalid_fee: "Network is unavailable. Try again shortly."
};

export default function PayExperience({ recipient }: { recipient: string }) {
  const valid = StrKey.isValidEd25519PublicKey(recipient);
  const { requestWallet, signTransaction } = useStellarWallet();
  const [assetId, setAssetId] = useState(ASSETS[0].assetId);
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "busy" } | { kind: "done"; hash: string } | { kind: "error"; message: string }>({ kind: "idle" });

  async function pay() {
    const me = await requestWallet();
    if (!me) return;
    setState({ kind: "busy" });
    try {
      const [sender, fee, target] = await Promise.all([
        loadAccount(me), loadFeePerOperation(),
        loadAccount(recipient).catch(e => { if (e instanceof ClientError && e.code === "inactive") return null; throw e; })
      ]);
      const plan = buildPayment({ sender, recipient: target, recipientId: recipient, asset: assetId, amount: amount.trim(), memo, feePerOperation: fee });
      let signed: string;
      try {
        signed = await signTransaction(plan.xdr, plan.intent, { title: plan.creates ? "Approve payment (activates account)" : "Approve payment" });
      } catch (e) {
        setState(e instanceof TxGuardError ? { kind: "error", message: guardMessage(e) } : { kind: "idle" });
        return;
      }
      const outcome = await submitSigned(signed);
      setState(outcome.status === "confirmed" ? { kind: "done", hash: outcome.hash }
        : { kind: "error", message: outcome.status === "failed" ? outcome.message : "Submitted but not confirmed yet. Check your activity before retrying." });
    } catch (e) {
      setState({ kind: "error", message: e instanceof PaymentError ? MESSAGES[e.code] : e instanceof ClientError && e.code === "inactive" ? "Your account isn't active yet." : "Network is unavailable. Try again shortly." });
    }
  }

  return <div className="nx-receipt">
    <section className="nx-panel nx-receipt-panel">
      <div className="nx-panel-kicker">SEND PAYMENT</div>
      {!valid ? <p className="nx-wallet-error">This payment link isn’t valid.</p> : <>
        <h1>Pay</h1>
        <code className="nx-receipt-hash">{recipient}</code>
        <div className="nx-voucher-choice-row">{ASSETS.map(a => <button key={a.assetId} type="button" className={assetId === a.assetId ? "active" : ""} onClick={() => setAssetId(a.assetId)}>{a.code}</button>)}</div>
        <input className="nx-wallet-input" inputMode="decimal" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="Amount"/>
        <input className="nx-wallet-input" placeholder="Memo (optional)" value={memo} onChange={e => setMemo(e.target.value)} aria-label="Memo" maxLength={28}/>
        {state.kind === "error" && <p className="nx-wallet-error" role="alert">{state.message}</p>}
        {state.kind === "done" ? <p className="nx-wallet-lede"><CheckCircle2 size={16}/> Payment confirmed. <Link href={`/receipt/${state.hash}`}>Receipt</Link></p>
          : <button type="button" className="nx-wallet-primary" disabled={!amount || state.kind === "busy"} onClick={() => void pay()}>{state.kind === "busy" ? <><LoaderCircle className="nx-spin" size={14}/> Working…</> : "Review payment"}</button>}
      </>}
    </section>
  </div>;
}
