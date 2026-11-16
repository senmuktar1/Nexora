/**
 * Client-side wallet encryption.
 *
 * - Key derivation: PBKDF2-HMAC-SHA256 (Web Crypto), 600k iterations by default
 *   (OWASP 2023 recommendation for PBKDF2-SHA256), random 16-byte salt.
 * - Encryption: AES-256-GCM, random 12-byte IV, the wallet public key bound as
 *   additional authenticated data so a ciphertext cannot be re-labelled.
 *
 * Plaintext secret material only ever exists in memory as Uint8Array buffers,
 * which callers must wipe() after use. Nothing in this module logs or throws
 * secret material.
 */

export const WALLET_VAULT_VERSION = 1 as const;
export const DEFAULT_KDF_ITERATIONS = 600_000;
export const MIN_PASSWORD_LENGTH = 10;

export type EncryptedVault = {
  version: typeof WALLET_VAULT_VERSION;
  publicKey: string;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string };
  ciphertext: string;
  createdAt: string;
};

export class WalletCryptoError extends Error {
  constructor(public readonly code: "bad_password" | "corrupt_vault" | "unsupported" | "weak_password") {
    super(code);
    this.name = "WalletCryptoError";
  }
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new WalletCryptoError("unsupported");
  return s;
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(length));
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function wipe(buffer: Uint8Array | null | undefined) {
  if (buffer) buffer.fill(0);
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function utf8(value: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(value);
  const out = new Uint8Array(new ArrayBuffer(encoded.length));
  out.set(encoded);
  wipe(encoded);
  return out;
}

export function assertPasswordStrength(password: string) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new WalletCryptoError("weak_password");
  }
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const passwordBytes = utf8(password);
  try {
    const base = await subtle().importKey("raw", passwordBytes, "PBKDF2", false, ["deriveKey"]);
    return await subtle().deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  } finally {
    wipe(passwordBytes);
  }
}

export async function encryptSecret(
  rawSecret: Uint8Array,
  publicKey: string,
  password: string,
  iterations = DEFAULT_KDF_ITERATIONS
): Promise<EncryptedVault> {
  assertPasswordStrength(password);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt, iterations);
  const plaintext = new Uint8Array(new ArrayBuffer(rawSecret.length));
  plaintext.set(rawSecret);
  try {
    const ciphertext = new Uint8Array(
      await subtle().encrypt({ name: "AES-GCM", iv, additionalData: utf8(publicKey) }, key, plaintext)
    );
    return {
      version: WALLET_VAULT_VERSION,
      publicKey,
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: toBase64(salt) },
      cipher: { name: "AES-GCM", iv: toBase64(iv) },
      ciphertext: toBase64(ciphertext),
      createdAt: new Date().toISOString()
    };
  } finally {
    wipe(plaintext);
  }
}

export function isEncryptedVault(value: unknown): value is EncryptedVault {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const kdf = v.kdf as Record<string, unknown> | undefined;
  const cipher = v.cipher as Record<string, unknown> | undefined;
  return v.version === WALLET_VAULT_VERSION
    && typeof v.publicKey === "string"
    && typeof v.ciphertext === "string"
    && !!kdf && kdf.name === "PBKDF2" && kdf.hash === "SHA-256"
    && typeof kdf.iterations === "number" && kdf.iterations >= 100_000 && typeof kdf.salt === "string"
    && !!cipher && cipher.name === "AES-GCM" && typeof cipher.iv === "string";
}

/** Returns the raw 32-byte secret. Caller MUST wipe() it after use. */
export async function decryptSecret(vault: EncryptedVault, password: string): Promise<Uint8Array> {
  if (!isEncryptedVault(vault)) throw new WalletCryptoError("corrupt_vault");
  let salt: Uint8Array<ArrayBuffer>, iv: Uint8Array<ArrayBuffer>, ciphertext: Uint8Array<ArrayBuffer>;
  try {
    salt = fromBase64(vault.kdf.salt);
    iv = fromBase64(vault.cipher.iv);
    ciphertext = fromBase64(vault.ciphertext);
  } catch {
    throw new WalletCryptoError("corrupt_vault");
  }
  const key = await deriveKey(password, salt, vault.kdf.iterations);
  try {
    const plain = await subtle().decrypt({ name: "AES-GCM", iv, additionalData: utf8(vault.publicKey) }, key, ciphertext);
    return new Uint8Array(plain);
  } catch {
    // AES-GCM authentication failure: wrong password or tampered vault. Indistinguishable by design.
    throw new WalletCryptoError("bad_password");
  }
}
