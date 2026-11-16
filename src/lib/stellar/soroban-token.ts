import { Buffer } from "buffer";
import { Account, Address, hash, nativeToScVal, Operation, StrKey, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { NEXORA_NETWORK_PASSPHRASE, type SignIntent } from "./tx-guard";

/**
 * NEXORA fixed-supply SEP-41 token (contracts/nexora-token, OpenZeppelin stellar-tokens).
 * Constructor: (name: String, symbol: String, decimals: u32, recipient: Address, supply: i128).
 * The whole supply is minted once to `recipient`; there is no mint function or admin.
 *
 * The wasm is served from /contracts/nexora-token.wasm and pinned by SHA-256 below (the
 * Soroban wasm hash). Built with stellar-cli 30.0.1 / rustc 1.97.0 — see contracts/README.md.
 */
export const NEXORA_TOKEN_WASM_HASH = "80d27ccd6861a5045369c83d101eb964ae2a709f4443e5f75cf96726c5038878";
export const NEXORA_TOKEN_WASM_PATH = "/contracts/nexora-token.wasm";
export const UPLOAD_MAX_FEE_STROOPS = 500_000_000; // 50 XLM ceiling for the one-time code upload
export const DEPLOY_MAX_FEE_STROOPS = 100_000_000; // 10 XLM ceiling for deploy + constructor
export const SOROBAN_DEPLOY_VALIDITY_SECONDS = 180;

export class TokenError extends Error {
  constructor(public readonly code: "wasm_mismatch" | "invalid_name" | "invalid_symbol" | "invalid_decimals" | "invalid_supply" | "invalid_salt") { super(code); }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy);
  return Buffer.from(digest).toString("hex");
}

/** Fetches the token wasm and refuses it unless it matches the pinned hash. */
export async function loadTokenWasm(fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  const response = await fetcher(NEXORA_TOKEN_WASM_PATH, { cache: "force-cache" });
  if (!response.ok) throw new TokenError("wasm_mismatch");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if ((await sha256Hex(bytes)) !== NEXORA_TOKEN_WASM_HASH) throw new TokenError("wasm_mismatch");
  return bytes;
}

export type TokenParams = { name: string; symbol: string; decimals: number; recipient: string; supplyUnits: bigint };

export function validateTokenParams(p: TokenParams) {
  if (!p.name.trim() || p.name.length > 64) throw new TokenError("invalid_name");
  if (!/^[A-Za-z0-9]{1,12}$/.test(p.symbol)) throw new TokenError("invalid_symbol");
  if (!Number.isInteger(p.decimals) || p.decimals < 0 || p.decimals > 18) throw new TokenError("invalid_decimals");
  if (p.supplyUnits <= 0n || p.supplyUnits > (1n << 127n) - 1n) throw new TokenError("invalid_supply");
  if (!StrKey.isValidEd25519PublicKey(p.recipient)) throw new TokenError("invalid_supply");
}

export function constructorArgs(p: TokenParams): xdr.ScVal[] {
  validateTokenParams(p);
  return [
    nativeToScVal(p.name, { type: "string" }),
    nativeToScVal(p.symbol, { type: "string" }),
    nativeToScVal(p.decimals, { type: "u32" }),
    new Address(p.recipient).toScVal(),
    nativeToScVal(p.supplyUnits, { type: "i128" })
  ];
}

const b64 = (v: xdr.ScVal) => (v as unknown as { toXDR: (f: "base64") => string }).toXDR("base64");
export const constructorArgsBase64 = (p: TokenParams) => constructorArgs(p).map(b64);

/** Contract ID that CreateContractV2 will assign: hash(networkId, deployer address, salt). */
export function predictContractId(deployer: string, salt: Uint8Array): string {
  if (salt.length !== 32) throw new TokenError("invalid_salt");
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(new xdr.HashIdPreimageContractId({
    networkId: hash(Buffer.from(NEXORA_NETWORK_PASSPHRASE)),
    contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(new xdr.ContractIdPreimageFromAddress({
      address: new Address(deployer).toScAddress(),
      salt: Buffer.from(salt)
    }))
  }));
  return StrKey.encodeContract(hash((preimage as unknown as { toXDR: () => Buffer }).toXDR()));
}

function txFor(source: { id: string; sequence: string }, op: xdr.Operation, nowSec: number) {
  return new TransactionBuilder(new Account(source.id, source.sequence), {
    fee: "1000", networkPassphrase: NEXORA_NETWORK_PASSPHRASE, timebounds: { minTime: 0, maxTime: nowSec + SOROBAN_DEPLOY_VALIDITY_SECONDS }
  }).addOperation(op).build().toEnvelope().toXDR("base64");
}

/** Unsigned (pre-simulation) upload transaction + the intent the guard enforces after simulation. */
export function buildUploadTx(source: { id: string; sequence: string }, wasm: Uint8Array, now = Date.now()) {
  const op = Operation.uploadContractWasm({ wasm: Buffer.from(wasm) });
  const intent: Omit<SignIntent, "source"> = {
    networkPassphrase: NEXORA_NETWORK_PASSPHRASE,
    operations: [{ type: "uploadContractWasm", wasmHash: NEXORA_TOKEN_WASM_HASH }],
    maxFeeStroops: UPLOAD_MAX_FEE_STROOPS,
    maxValiditySeconds: SOROBAN_DEPLOY_VALIDITY_SECONDS + 15
  };
  return { xdr: txFor(source, op, Math.floor(now / 1000)), intent };
}

/** Unsigned deploy transaction (deployer = wallet) + exact-match intent + predicted contract ID. */
export function buildDeployTx(source: { id: string; sequence: string }, params: TokenParams, salt: Uint8Array, now = Date.now()) {
  if (salt.length !== 32) throw new TokenError("invalid_salt");
  const args = constructorArgs(params);
  const op = Operation.createCustomContract({
    address: new Address(source.id), wasmHash: Buffer.from(NEXORA_TOKEN_WASM_HASH, "hex"), salt: Buffer.from(salt), constructorArgs: args
  });
  const intent: Omit<SignIntent, "source"> = {
    networkPassphrase: NEXORA_NETWORK_PASSPHRASE,
    operations: [{ type: "createContract", wasmHash: NEXORA_TOKEN_WASM_HASH, deployer: source.id, salt: Buffer.from(salt).toString("hex"), constructorArgs: args.map(b64) }],
    maxFeeStroops: DEPLOY_MAX_FEE_STROOPS,
    maxValiditySeconds: SOROBAN_DEPLOY_VALIDITY_SECONDS + 15
  };
  return { xdr: txFor(source, op, Math.floor(now / 1000)), intent, contractId: predictContractId(source.id, salt) };
}
