"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from "react";
import { TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import * as session from "@/lib/wallet/session";
import { guardTransaction, NEXORA_NETWORK_PASSPHRASE, TxGuardError, type SignIntent } from "@/lib/stellar/tx-guard";
import { describeTransaction } from "@/lib/stellar/describe";
import TransactionApproval, { type ApprovalRequest } from "./TransactionApproval";
import WalletDialog, { type WalletDialogMode } from "./WalletDialog";

export type StellarNetwork = "mainnet";

type WalletContextValue = {
  /** Public address of the local wallet (available while locked or unlocked). */
  address: string | null;
  status: session.WalletStatus;
  unlocked: boolean;
  network: StellarNetwork;
  /** Opens onboarding (no wallet) or unlock (locked). Resolves with the wallet address once unlocked, else null. */
  requestWallet: () => Promise<string | null>;
  lock: () => void;
  /**
   * Validates the XDR against the intent, shows the wallet approval sheet decoded
   * from that exact XDR, and signs only after the user approves. Rejects with
   * Error("rejected") if the user declines, or TxGuardError if the XDR doesn't match.
   */
  signTransaction: (envelopeXdr: string, intent: Omit<SignIntent, "source">, display?: SignDisplay) => Promise<string>;
  deleteAccount: () => Promise<void>;
  /** Encrypted per-wallet storage (keyed off the wallet seed). Prompts unlock if needed. */
  saveRecord: (key: string, value: unknown) => Promise<void>;
  loadRecords: <T>(prefix: string) => Promise<{ key: string; value: T }[]>;
};

export type SignDisplay = { title?: string; estimates?: [string, string][] };

const WalletContext = createContext<WalletContextValue | null>(null);

const SERVER_SNAPSHOT = { status: "loading" as const, publicKey: null };
let cachedSnapshot: ReturnType<typeof session.getSnapshot> = SERVER_SNAPSHOT;

function readSnapshot() {
  const next = session.getSnapshot();
  if (next.status !== cachedSnapshot.status || next.publicKey !== cachedSnapshot.publicKey) cachedSnapshot = next;
  return cachedSnapshot;
}

/** Keys NEXORA writes to browser storage. Cleared on account deletion. */
const LOCAL_KEY_PREFIX = "nexora";

function guardSigned(signedXdr: string) {
  return TransactionBuilder.fromXDR(signedXdr, NEXORA_NETWORK_PASSPHRASE) as Transaction;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(session.subscribe, readSnapshot, () => SERVER_SNAPSHOT);
  const [dialog, setDialog] = useState<WalletDialogMode | null>(null);
  const waiters = useRef<((address: string | null) => void)[]>([]);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const approvalRef = useRef<{ xdr: string; intent: Omit<SignIntent, "source">; hash: string; resolve: (signed: string) => void; reject: (error: Error) => void } | null>(null);

  useEffect(() => {
    void session.initialise();
    // Lock when the tab is hidden for a while is handled by the session auto-lock;
    // lock immediately when the page is being unloaded.
    const onHide = () => session.lock();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  const settle = useCallback((address: string | null) => {
    const pending = waiters.current;
    waiters.current = [];
    pending.forEach(resolve => resolve(address));
  }, []);

  const requestWallet = useCallback(() => {
    if (session.isUnlocked()) return Promise.resolve(session.getSnapshot().publicKey);
    const current = session.getSnapshot().status;
    if (current === "unsupported" || current === "loading") return Promise.resolve(null);
    setDialog(current === "locked" ? "unlock" : "welcome");
    return new Promise<string | null>(resolve => { waiters.current.push(resolve); });
  }, []);

  const closeDialog = useCallback(() => {
    setDialog(null);
    settle(session.isUnlocked() ? session.getSnapshot().publicKey : null);
  }, [settle]);

  const signTransaction = useCallback(async (envelopeXdr: string, intent: Omit<SignIntent, "source">, display?: SignDisplay) => {
    if (approvalRef.current) throw new Error("approval_pending");
    if (!session.isUnlocked() && !(await requestWallet())) throw new Error("wallet_locked");
    const source = session.getSnapshot().publicKey;
    if (!source) throw new Error("wallet_locked");
    // Guard first (no key needed), then show exactly this transaction for approval.
    const parsed = guardTransaction(envelopeXdr, { ...intent, source });
    const described = describeTransaction(parsed);
    return new Promise<string>((resolve, reject) => {
      approvalRef.current = { xdr: envelopeXdr, intent, hash: described.hash, resolve, reject };
      setApproval({ described, title: display?.title ?? "Approve transaction", estimates: display?.estimates });
    });
  }, [requestWallet]);

  const finishApproval = useCallback((approved: boolean) => {
    const pending = approvalRef.current;
    approvalRef.current = null;
    setApproval(null);
    if (!pending) return;
    if (!approved) { pending.reject(new Error("rejected")); return; }
    try {
      // Signs the identical XDR string that was decoded for the sheet; the guard re-runs with the current time.
      const signed = session.signWithIntent(pending.xdr, pending.intent);
      const check = describeTransaction(guardSigned(signed));
      if (check.hash !== pending.hash) throw new TxGuardError("hash_mismatch");
      pending.resolve(signed);
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error("sign_failed"));
    }
  }, []);

  const approve = useCallback(() => finishApproval(true), [finishApproval]);
  const rejectApproval = useCallback(() => finishApproval(false), [finishApproval]);

  const deleteAccount = useCallback(async () => {
    if (approvalRef.current) { approvalRef.current.reject(new Error("rejected")); approvalRef.current = null; setApproval(null); }
    await session.deleteLocalWallet();
    try {
      for (const store of [window.localStorage, window.sessionStorage]) {
        Object.keys(store).filter(key => key.toLowerCase().startsWith(LOCAL_KEY_PREFIX)).forEach(key => store.removeItem(key));
      }
    } catch {
      // Storage may be unavailable (private mode); nothing to clear then.
    }
    try {
      if ("caches" in window) for (const name of await caches.keys()) await caches.delete(name);
    } catch {
      // Cache Storage is optional.
    }
  }, []);

  const saveRecord = useCallback(async (key: string, value: unknown) => {
    if (!session.isUnlocked() && !(await requestWallet())) throw new Error("wallet_locked");
    await session.saveSealedRecord(key, value);
  }, [requestWallet]);
  const loadRecords = useCallback(async <T,>(prefix: string) => {
    if (!session.isUnlocked() && !(await requestWallet())) throw new Error("wallet_locked");
    return session.loadSealedRecords<T>(prefix);
  }, [requestWallet]);

  const value = useMemo<WalletContextValue>(() => ({
    address: snapshot.publicKey,
    status: snapshot.status,
    unlocked: snapshot.status === "unlocked",
    network: "mainnet",
    requestWallet,
    lock: session.lock,
    signTransaction,
    deleteAccount,
    saveRecord,
    loadRecords
  }), [snapshot, requestWallet, signTransaction, deleteAccount, saveRecord, loadRecords]);

  return <WalletContext.Provider value={value}>
    {children}
    {dialog && <WalletDialog initialMode={dialog} onClose={closeDialog}/>}
    {approval && <TransactionApproval request={approval} onApprove={approve} onReject={rejectApproval}/>}
  </WalletContext.Provider>;
}

export function useStellarWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useStellarWallet must be used inside WalletProvider.");
  return value;
}
