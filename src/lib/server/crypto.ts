import "server-only";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

type ScryptOpts = { N: number; r: number; p: number; maxmem: number };
function scrypt(pw: string, salt: Buffer, len: number, opts: ScryptOpts): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(pw, salt, len, opts, (err, key) => err ? reject(err) : resolve(key)));
}

/* ── Passwords: scrypt (N=2^15, r=8, p=1), per-user salt, constant-time compare. ── */
const SCRYPT: ScryptOpts = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every(Number.isInteger) || N > 1 << 20) return false;
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  const key = await scrypt(password.normalize("NFKC"), salt, expected.length, { N, r, p, maxmem: SCRYPT.maxmem });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A hash of a random password, used to equalise timing for unknown accounts. */
let dummy: Promise<string> | null = null;
export function dummyHash() { return (dummy ??= hashPassword(randomBytes(16).toString("hex"))); }

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || !password) return "Enter a password.";
  if (password.length < 12) return "Use at least 12 characters.";
  if (password.length > 200) return "Use at most 200 characters.";
  if (new Set(password).size < 5) return "Choose a less repetitive password.";
  return null;
}

/* ── Tokens ── */
export function randomToken(bytes = 32): string { return randomBytes(bytes).toString("base64url"); }
export function sha256Hex(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }

/** Constant-time string comparison (via fixed-length digests). */
export function safeEqual(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

/* ── Data encryption (MFA secrets, documents): AES-256-GCM, key from DATA_ENCRYPTION_KEY. ── */
export class EncryptionUnavailable extends Error { constructor() { super("encryption_key_missing"); } }

function masterKey(): Buffer {
  const raw = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (!raw) throw new EncryptionUnavailable();
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new EncryptionUnavailable();
  return key;
}

export function encryptionConfigured(): boolean {
  try { masterKey(); return true; } catch { return false; }
}

type Purpose = "mfa" | "document";
function subKey(purpose: Purpose): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey(), Buffer.alloc(0), `nexora:${purpose}:v1`, 32));
}

export function encryptBytes(purpose: Purpose, plain: Buffer, aad: string): { iv: Buffer; ciphertext: Buffer } {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", subKey(purpose), iv);
  c.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
  return { iv, ciphertext };
}

export function decryptBytes(purpose: Purpose, iv: Buffer, ciphertext: Buffer, aad: string): Buffer {
  const d = createDecipheriv("aes-256-gcm", subKey(purpose), iv);
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  return Buffer.concat([d.update(ciphertext.subarray(0, ciphertext.length - 16)), d.final()]);
}

export function encryptString(purpose: "mfa", text: string, aad: string): string {
  const { iv, ciphertext } = encryptBytes(purpose, Buffer.from(text), aad);
  return `${iv.toString("base64")}.${ciphertext.toString("base64")}`;
}

export function decryptString(purpose: "mfa", sealed: string, aad: string): string {
  const [iv, ct] = sealed.split(".");
  return decryptBytes(purpose, Buffer.from(iv, "base64"), Buffer.from(ct, "base64"), aad).toString();
}
