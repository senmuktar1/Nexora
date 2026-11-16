import { Account, Asset, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { NEXORA_NETWORK_PASSPHRASE, type SignIntent } from "./tx-guard";
import { hasTrustline, MAX_FEE_PER_OPERATION, type AccountState } from "./swap";

/**
 * Transactions for restricted (AUTH_REQUIRED) RWA tokens. All are signed in the user's
 * own browser wallet after the approval sheet; nothing is signed by NEXORA's server.
 */
export class RwaOpError extends Error {
  constructor(public readonly code: "invalid_fee" | "already_trusted" | "invalid_asset") { super(code); }
}

const VALIDITY = 180;
function builder(account: AccountState, fee: number, now = Date.now()) {
  if (!Number.isFinite(fee) || fee < 100 || fee > MAX_FEE_PER_OPERATION) throw new RwaOpError("invalid_fee");
  return new TransactionBuilder(new Account(account.id, account.sequence), {
    fee: String(fee), networkPassphrase: NEXORA_NETWORK_PASSPHRASE, timebounds: { minTime: 0, maxTime: Math.floor(now / 1000) + VALIDITY }
  });
}

/** Investor: open a trustline to the token (it stays unusable until the issuer authorises it). */
export function buildRwaTrustline(account: AccountState, code: string, issuer: string, fee: number, now?: number) {
  let asset: Asset;
  try { asset = new Asset(code, issuer); } catch { throw new RwaOpError("invalid_asset"); }
  const assetId = `${code}:${issuer}`;
  if (hasTrustline(account, assetId)) throw new RwaOpError("already_trusted");
  const tx = builder(account, fee, now).addOperation(Operation.changeTrust({ asset })).build();
  const intent: Omit<SignIntent, "source"> = {
    networkPassphrase: NEXORA_NETWORK_PASSPHRASE, operations: [{ type: "changeTrust", asset: assetId }], maxFeeStroops: fee, maxValiditySeconds: VALIDITY + 5
  };
  return { xdr: tx.toEnvelope().toXDR("base64"), intent };
}

/**
 * Issuer: authorise an approved investor's trustline. The wallet pays the fee; the
 * operation's source is the token's issuer account, which co-signs locally.
 */
export function buildAuthorizeTrustline(wallet: AccountState, code: string, issuer: string, trustor: string, fee: number, now?: number) {
  let asset: Asset;
  try { asset = new Asset(code, issuer); } catch { throw new RwaOpError("invalid_asset"); }
  const tx = builder(wallet, fee, now)
    .addOperation(Operation.setTrustLineFlags({ source: issuer, trustor, asset, flags: { authorized: true } }))
    .build();
  const intent: Omit<SignIntent, "source"> = {
    networkPassphrase: NEXORA_NETWORK_PASSPHRASE,
    operations: [{ type: "setTrustLineFlags", source: issuer, trustor, asset: `${code}:${issuer}`, authorized: true }],
    maxFeeStroops: fee, maxValiditySeconds: VALIDITY + 5
  };
  return { xdr: tx.toEnvelope().toXDR("base64"), intent };
}
