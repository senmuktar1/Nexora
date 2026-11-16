"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useStellarWallet } from "./WalletProvider";

const CONFIRM_WORD = "DELETE";

export default function DeleteAccount() {
  const { address, deleteAccount, requestWallet } = useStellarWallet();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!address) return null;

  async function confirmDelete() {
    if (typed !== CONFIRM_WORD) return;
    setBusy(true);
    setFailed(false);
    try {
      await deleteAccount();
      setOpen(false);
      router.push("/");
      void requestWallet();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return <section className="nx-panel nx-delete-account" id="delete-account">
    <div>
      <h2>Delete account</h2>
      <p>Removes your NEXORA account and the encrypted wallet from this device.</p>
    </div>
    {!open ? <button type="button" className="nx-danger-button" onClick={() => setOpen(true)}><Trash2 size={14}/> Delete account</button> : <div className="nx-delete-confirm">
      <ul>
        <li>Your encrypted wallet, settings and watchlists on this device are erased.</li>
        <li>Your Stellar account and its assets stay on the blockchain. Deleting NEXORA data does not move or erase them.</li>
        <li>To use this wallet again, import it with your secret key. Without the key, access cannot be recovered.</li>
      </ul>
      <label htmlFor="nx-delete-confirm">Type <strong>{CONFIRM_WORD}</strong> to confirm</label>
      <input id="nx-delete-confirm" className="nx-wallet-input" value={typed} onChange={event => setTyped(event.target.value)} autoComplete="off" spellCheck={false}/>
      {failed && <p className="nx-wallet-error" role="alert">Deletion didn&apos;t complete. Try again.</p>}
      <div className="nx-delete-actions">
        <button type="button" className="nx-delete-cancel" onClick={() => { setOpen(false); setTyped(""); }} disabled={busy}>Cancel</button>
        <button type="button" className="nx-danger-button" disabled={typed !== CONFIRM_WORD || busy} onClick={() => void confirmDelete()}>{busy ? "Deleting…" : "Delete permanently"}</button>
      </div>
    </div>}
  </section>;
}
