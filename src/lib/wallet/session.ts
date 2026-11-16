import type { Keypair } from "@stellar/stellar-sdk";
import {
  DEFAULT_KDF_ITERATIONS,
  WalletCryptoError,
  assertPasswordStrength,
  decryptSecret,
  encryptSecret,
  wipe,
  type EncryptedVault
} from "./crypto";
import { keypairFromRaw, rawSecretFromSecret } from "./keys";
import { destroyVault, listRecords, loadVault, putRecord, saveVault } from "./storage";
import { fromBase64, randomBytes, toBase64 } from "./crypto";
import { guardTransaction, type SignIntent } from "../stellar/tx-guard";

/**
 * The single wallet abstraction used by every NEXORA module.
 *
 * The decrypted keypair lives only in this module's closure while unlocked —
 * never in React state, storage, logs or network requests. Signing is only
 * possible through signWithIntent(), which runs the pre-sign guard first.
 */

export type WalletStatus = "loading" | "none" | "locked" | "unlocked" | "unsupported";

type Listener = () => void;

const AUTO_LOCK_MS = 15 * 60 * 1000;

let keypair: Keypair | null = null;
let vaultMeta: { publicKey: string } | null = null;
let status: WalletStatus = "loading";
let lockTimer: ReturnType<typeof setTimeout> | null = null;
let failedAttempts = 0;
let lockedOutUntil = 0;
let kdfIterations = DEFAULT_KDF_ITERATIONS;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

function setStatus(next: WalletStatus) {
  status = next;
  emit();
}

function armAutoLock() {
  if (lockTimer) clearTimeout(lockTimer);
  lockTimer = setTimeout(() => lock(), AUTO_LOCK_MS);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): { status: WalletStatus; publicKey: string | null } {
  return { status, publicKey: vaultMeta?.publicKey ?? null };
}

/** Test hook: lower PBKDF2 cost. Not used by the app. */
export function __setKdfIterationsForTests(iterations: number) {
  kdfIterations = iterations;
}

export async function initialise(): Promise<void> {
  if (typeof globalThis.crypto?.subtle === "undefined" || typeof indexedDB === "undefined") {
    setStatus("unsupported");
    return;
  }
  try {
    const vault = await loadVault();
    vaultMeta = vault ? { publicKey: vault.publicKey } : null;
    setStatus(vault ? (keypair ? "unlocked" : "locked") : "none");
  } catch {
    setStatus("unsupported");
  }
}

async function storeSecret(secret: string, password: string): Promise<string> {
  assertPasswordStrength(password);
  const raw = rawSecretFromSecret(secret);
  try {
    const kp = keypairFromRaw(raw);
    const vault: EncryptedVault = await encryptSecret(raw, kp.publicKey(), password, kdfIterations);
    await saveVault(vault);
    keypair = kp;
    vaultMeta = { publicKey: kp.publicKey() };
    failedAttempts = 0;
    armAutoLock();
    setStatus("unlocked");
    return kp.publicKey();
  } finally {
    wipe(raw);
  }
}

/** Used both for "create" (with a freshly generated secret) and "import". */
export function saveWallet(secret: string, password: string): Promise<string> {
  return storeSecret(secret, password);
}

export type UnlockResult = { ok: true } | { ok: false; reason: "bad_password" | "throttled" | "no_wallet" | "corrupt" };

export async function unlock(password: string): Promise<UnlockResult> {
  if (Date.now() < lockedOutUntil) return { ok: false, reason: "throttled" };
  const vault = await loadVault();
  if (!vault) return { ok: false, reason: "no_wallet" };
  let raw: Uint8Array | null = null;
  try {
    raw = await decryptSecret(vault, password);
    const kp = keypairFromRaw(raw);
    if (kp.publicKey() !== vault.publicKey) return { ok: false, reason: "corrupt" };
    keypair = kp;
    vaultMeta = { publicKey: vault.publicKey };
    failedAttempts = 0;
    armAutoLock();
    setStatus("unlocked");
    return { ok: true };
  } catch (error) {
    if (error instanceof WalletCryptoError && error.code === "bad_password") {
      failedAttempts += 1;
      if (failedAttempts >= 5) lockedOutUntil = Date.now() + Math.min(2 ** (failedAttempts - 5), 64) * 30_000;
      return { ok: false, reason: "bad_password" };
    }
    return { ok: false, reason: "corrupt" };
  } finally {
    wipe(raw);
  }
}

export function lock() {
  if (lockTimer) clearTimeout(lockTimer);
  lockTimer = null;
  keypair = null;
  if (status === "unlocked") setStatus(vaultMeta ? "locked" : "none");
}

export function isUnlocked() {
  return keypair !== null;
}

/**
 * Validates the unsigned XDR against the declared intent, then signs locally.
 * Throws TxGuardError if anything does not match; throws "wallet_locked" if locked.
 */
export function signWithIntent(envelopeXdr: string, intent: Omit<SignIntent, "source">): string {
  if (!keypair) throw new Error("wallet_locked");
  const tx = guardTransaction(envelopeXdr, { ...intent, source: keypair.publicKey() });
  tx.sign(keypair);
  armAutoLock();
  return tx.toEnvelope().toXDR("base64");
}

/** Permanently removes the local wallet and all NEXORA browser data. */
export async function deleteLocalWallet(): Promise<void> {
  lock();
  await destroyVault();
  vaultMeta = null;
  failedAttempts = 0;
  lockedOutUntil = 0;
  setStatus("none");
}

// ---------- sealed per-wallet records ----------

async function recordKey(): Promise<CryptoKey> {
  if (!keypair) throw new Error("wallet_locked");
  const seed = new Uint8Array(keypair.rawSecretKey());
  try {
    const base = await crypto.subtle.importKey("raw", seed, "HKDF", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("nexora/records/v1"), info: new TextEncoder().encode(keypair.publicKey()) },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
  } finally {
    wipe(seed);
  }
}

/** Encrypts JSON with a key derived from the wallet seed and stores it under `key`. Requires unlock. */
export async function saveSealedRecord(key: string, value: unknown): Promise<void> {
  const k = await recordKey();
  const iv = randomBytes(12);
  const data = new TextEncoder().encode(JSON.stringify(value));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, data));
  wipe(data);
  await putRecord(key, `${toBase64(iv)}.${toBase64(ct)}`);
}

/** Lists and decrypts records with the given key prefix. Undecryptable records are skipped. */
export async function loadSealedRecords<T>(prefix: string): Promise<{ key: string; value: T }[]> {
  const k = await recordKey();
  const out: { key: string; value: T }[] = [];
  for (const { key, sealed } of await listRecords(prefix)) {
    try {
      const [iv, ct] = sealed.split(".");
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, k, fromBase64(ct));
      out.push({ key, value: JSON.parse(new TextDecoder().decode(plain)) as T });
    } catch {
      // Skip records sealed by a different wallet or corrupted.
    }
  }
  return out;
}
