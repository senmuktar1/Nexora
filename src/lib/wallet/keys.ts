import { Buffer } from "buffer";
import { Keypair, StrKey } from "@stellar/stellar-sdk";

export type GeneratedWallet = { publicKey: string; secret: string };

export function generateWallet(): GeneratedWallet {
  const keypair = Keypair.random();
  return { publicKey: keypair.publicKey(), secret: keypair.secret() };
}

/** Normalises user input and returns the matching public key, or null if invalid. */
export function publicKeyFromSecret(input: string): string | null {
  const secret = normaliseSecret(input);
  if (!StrKey.isValidEd25519SecretSeed(secret)) return null;
  return Keypair.fromSecret(secret).publicKey();
}

export function normaliseSecret(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

export function rawSecretFromSecret(input: string): Uint8Array {
  const secret = normaliseSecret(input);
  if (!StrKey.isValidEd25519SecretSeed(secret)) throw new Error("invalid_secret");
  return new Uint8Array(StrKey.decodeEd25519SecretSeed(secret));
}

export function keypairFromRaw(raw: Uint8Array): Keypair {
  return Keypair.fromRawEd25519Seed(Buffer.from(raw));
}

export function isValidPublicKey(value: string): boolean {
  return StrKey.isValidEd25519PublicKey(value);
}
