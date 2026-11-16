"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Check, Copy, Eye, EyeOff, KeyRound, LockKeyhole, Plus, X } from "lucide-react";
import Link from "next/link";
import * as session from "@/lib/wallet/session";
import { MIN_PASSWORD_LENGTH } from "@/lib/wallet/crypto";
import { generateWallet, publicKeyFromSecret, type GeneratedWallet } from "@/lib/wallet/keys";

export type WalletDialogMode = "welcome" | "create-backup" | "create-password" | "import" | "unlock";

function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

export default function WalletDialog({ initialMode, onClose }: { initialMode: WalletDialogMode; onClose: () => void }) {
  const [mode, setMode] = useState<WalletDialogMode>(initialMode);
  const [draft, setDraft] = useState<GeneratedWallet | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [backedUp, setBackedUp] = useState(false);
  const [importSecret, setImportSecret] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clipboardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const address = session.getSnapshot().publicKey;

  // Drop secret material from component state when the dialog unmounts.
  useEffect(() => () => {
    if (clipboardTimer.current) clearTimeout(clipboardTimer.current);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  function go(next: WalletDialogMode) {
    setError(null);
    setPassword("");
    setConfirm("");
    setMode(next);
  }

  function startCreate() {
    setDraft(generateWallet());
    setRevealed(false);
    setBackedUp(false);
    go("create-backup");
  }

  async function copySecret() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
      // Best effort: clear the clipboard after a minute if it still holds the key.
      if (clipboardTimer.current) clearTimeout(clipboardTimer.current);
      clipboardTimer.current = setTimeout(() => {
        void navigator.clipboard.readText().then(text => {
          if (text === draft.secret) void navigator.clipboard.writeText("");
        }).catch(() => undefined);
      }, 60_000);
    } catch {
      setError("Copy failed. Select the key and copy it manually.");
    }
  }

  function passwordProblem(): string | null {
    if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (password !== confirm) return "Passwords don't match.";
    return null;
  }

  async function finishSave(secret: string) {
    const problem = passwordProblem();
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    try {
      await session.saveWallet(secret, password);
      setDraft(null);
      setImportSecret("");
      onClose();
    } catch {
      setError("The wallet couldn't be saved in this browser. Check that site storage is allowed.");
    } finally {
      setBusy(false);
      setPassword("");
      setConfirm("");
    }
  }

  async function submitUnlock(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await session.unlock(password);
    setBusy(false);
    setPassword("");
    if (result.ok) { onClose(); return; }
    setError(result.reason === "bad_password" ? "Incorrect password."
      : result.reason === "throttled" ? "Too many attempts. Try again shortly."
      : "This wallet can't be opened. Import it again with your secret key.");
  }

  const importedAddress = importSecret.trim() ? publicKeyFromSecret(importSecret) : null;

  return <div className="nx-command-overlay nx-wallet-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="nx-wallet-dialog" role="dialog" aria-modal="true" aria-label="Wallet">
      <header className="nx-wallet-dialog-head">
        {mode !== "welcome" && mode !== "unlock" ? <button type="button" className="nx-wallet-dialog-icon" aria-label="Back" onClick={() => go(mode === "create-password" ? "create-backup" : "welcome")} disabled={busy}><ArrowLeft size={16}/></button> : <span/>}
        <strong>{mode === "unlock" ? "Unlock wallet" : mode === "import" ? "Import wallet" : mode === "welcome" ? "Set up your wallet" : "Create wallet"}</strong>
        <button type="button" className="nx-wallet-dialog-icon" aria-label="Close" onClick={onClose} disabled={busy}><X size={16}/></button>
      </header>

      {mode === "welcome" && <div className="nx-wallet-dialog-body">
        <p className="nx-wallet-lede">Your keys stay encrypted on this device. NEXORA never sees them.</p>
        <button type="button" className="nx-wallet-choice" onClick={startCreate}>
          <span><Plus size={18}/></span><div><strong>Create a new wallet</strong><small>Generate a new Stellar account</small></div>
        </button>
        <button type="button" className="nx-wallet-choice" onClick={() => go("import")}>
          <span><KeyRound size={18}/></span><div><strong>Import a wallet</strong><small>Use an existing Stellar secret key</small></div>
        </button>
      </div>}

      {mode === "create-backup" && draft && <div className="nx-wallet-dialog-body">
        <label className="nx-wallet-field-label">Address</label>
        <code className="nx-wallet-code">{draft.publicKey}</code>
        <label className="nx-wallet-field-label">Secret key</label>
        <div className="nx-wallet-secret">
          <code className={revealed ? "nx-wallet-code" : "nx-wallet-code nx-wallet-masked"} aria-label="Secret key">{revealed ? draft.secret : "S" + "•".repeat(55)}</code>
          <div className="nx-wallet-secret-actions">
            <button type="button" onClick={() => setRevealed(!revealed)}>{revealed ? <EyeOff size={14}/> : <Eye size={14}/>}{revealed ? "Hide" : "Reveal"}</button>
            <button type="button" onClick={() => void copySecret()}>{copied ? <Check size={14}/> : <Copy size={14}/>}{copied ? "Copied" : "Copy"}</button>
          </div>
        </div>
        <p className="nx-wallet-warning">This secret key is the only way to recover your wallet. Store it offline. Anyone who has it controls your funds, and NEXORA cannot restore it.</p>
        <label className="nx-wallet-check"><input type="checkbox" checked={backedUp} onChange={event => setBackedUp(event.target.checked)}/>I have saved my secret key somewhere safe.</label>
        <button type="button" className="nx-wallet-primary" disabled={!backedUp} onClick={() => go("create-password")}>Continue</button>
      </div>}

      {mode === "create-password" && draft && <form className="nx-wallet-dialog-body" onSubmit={event => { event.preventDefault(); void finishSave(draft.secret); }}>
        <p className="nx-wallet-lede">Set a password to unlock this wallet on this device.</p>
        <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm}/>
        {error && <p className="nx-wallet-error" role="alert">{error}</p>}
        <button type="submit" className="nx-wallet-primary" disabled={busy}>{busy ? "Encrypting…" : "Create wallet"}</button>
      </form>}

      {mode === "import" && <form className="nx-wallet-dialog-body" onSubmit={event => { event.preventDefault(); if (!importedAddress) { setError("Enter a valid Stellar secret key (starts with S)."); return; } void finishSave(importSecret); }}>
        <label className="nx-wallet-field-label" htmlFor="nx-import-secret">Secret key</label>
        <input id="nx-import-secret" className="nx-wallet-input" type="password" value={importSecret} onChange={event => { setImportSecret(event.target.value); setError(null); }} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} placeholder="S…"/>
        {importedAddress && <p className="nx-wallet-derived"><Check size={13}/> {short(importedAddress)}</p>}
        {importSecret.trim().length >= 56 && !importedAddress && <p className="nx-wallet-error">This isn&apos;t a valid Stellar secret key.</p>}
        <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm}/>
        {error && <p className="nx-wallet-error" role="alert">{error}</p>}
        <button type="submit" className="nx-wallet-primary" disabled={busy || !importedAddress}>{busy ? "Encrypting…" : "Import wallet"}</button>
      </form>}

      {mode === "unlock" && <form className="nx-wallet-dialog-body" onSubmit={event => void submitUnlock(event)}>
        {address && <code className="nx-wallet-code nx-wallet-center">{short(address)}</code>}
        <input className="nx-wallet-input" type="password" autoFocus value={password} onChange={event => setPassword(event.target.value)} placeholder="Password" autoComplete="current-password" aria-label="Password"/>
        {error && <p className="nx-wallet-error" role="alert">{error}</p>}
        <button type="submit" className="nx-wallet-primary" disabled={busy || !password}>{busy ? "Unlocking…" : <><LockKeyhole size={14}/> Unlock</>}</button>
        <Link href="/profile#delete-account" className="nx-wallet-link" onClick={onClose}>Forgot password?</Link>
      </form>}
    </section>
  </div>;
}

function PasswordFields({ password, confirm, onPassword, onConfirm }: { password: string; confirm: string; onPassword: (v: string) => void; onConfirm: (v: string) => void }) {
  return <>
    <input className="nx-wallet-input" type="password" value={password} onChange={event => onPassword(event.target.value)} placeholder={`Password (min ${MIN_PASSWORD_LENGTH} characters)`} autoComplete="new-password" aria-label="Password"/>
    <input className="nx-wallet-input" type="password" value={confirm} onChange={event => onConfirm(event.target.value)} placeholder="Confirm password" autoComplete="new-password" aria-label="Confirm password"/>
  </>;
}
