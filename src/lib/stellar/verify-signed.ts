import { Buffer } from "buffer";
import { Keypair, StrKey, type Transaction } from "@stellar/stellar-sdk";

/** Raw bytes of a decorated signature field across SDK XDR representations. */
function bytes(v: unknown): Buffer {
  if (v instanceof Uint8Array) return Buffer.from(v);
  const o = v as { value?: unknown } | (() => unknown);
  if (typeof o === "function") return bytes(o());
  if (o && typeof o === "object" && "value" in o) return bytes((o as { value: unknown }).value);
  return Buffer.alloc(0);
}

/**
 * Checks a signed transaction before relay: it must carry a valid signature from
 * the transaction source, and every signature must be valid for one of the
 * accounts the transaction involves (tx source or an operation source).
 */
export function verifyTransactionSignatures(tx: Transaction): boolean {
  if (tx.signatures.length === 0 || tx.signatures.length > 20) return false;
  const keys = new Set<string>([tx.source]);
  for (const op of tx.operations) {
    const src = (op as { source?: string }).source;
    if (src && StrKey.isValidEd25519PublicKey(src)) keys.add(src);
  }
  const hash = tx.hash();
  const signers = [...keys].map(k => Keypair.fromPublicKey(k));
  let sourceSigned = false;
  for (const sig of tx.signatures) {
    const raw = sig as unknown as { hint: unknown; signature: unknown };
    const hint = bytes(typeof raw.hint === "function" ? (raw.hint as () => unknown)() : raw.hint);
    const signature = bytes(typeof raw.signature === "function" ? (raw.signature as () => unknown)() : raw.signature);
    const signer = signers.find(k => Buffer.from(k.signatureHint()).equals(hint) && k.verify(Buffer.from(hash), signature));
    if (!signer) return false;
    if (signer.publicKey() === tx.source) sourceSigned = true;
  }
  return sourceSigned;
}
