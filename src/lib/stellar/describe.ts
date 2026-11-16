import { Buffer } from "buffer";
import { Address, Asset, hash, Networks, scValToNative, type Operation, type Transaction } from "@stellar/stellar-sdk";
import { toStroops } from "./tx-guard";
import { NEXORA_TOKEN_WASM_HASH, predictContractId } from "./soroban-token";

/**
 * Human-readable description of a parsed transaction, derived ONLY from the
 * transaction itself. The approval sheet renders this, so what the user approves
 * is exactly what is signed.
 */

export type DescribedOperation = { title: string; rows: [string, string][] };
export type DescribedTransaction = {
  hash: string;
  source: string;
  fee: string;
  validUntil: number | null;
  memo: string | null;
  operations: DescribedOperation[];
};

const REQUEST_NAMES: Record<number, string> = {
  0: "Supply", 1: "Withdraw", 2: "Supply as collateral", 3: "Withdraw collateral", 4: "Borrow", 5: "Repay",
  6: "Fill liquidation", 7: "Fill bad debt", 8: "Fill interest auction", 9: "Delete auction"
};

/** Stellar Asset Contract IDs derived (not hard-coded) for assets whose decimals are known (SACs use 7). */
let knownSacs: Map<string, string> | null = null;
function sacLabel(contract: string): string | null {
  knownSacs ??= new Map([
    [Asset.native().contractId(Networks.PUBLIC), "XLM"],
    [new Asset("USDC", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN").contractId(Networks.PUBLIC), "USDC"]
  ]);
  return knownSacs.get(contract) ?? null;
}

function describeSubmitArgs(args: unknown[]): [string, string][] {
  try {
    const native = (args as never[]).map(a => scValToNative(a));
    const [from, spender, to, requests] = native as [string, string, string, { address: string; amount: bigint; request_type: number }[]];
    const rows: [string, string][] = (requests ?? []).map(r => {
      const label = sacLabel(r.address);
      const amt = BigInt(r.amount);
      const value = label ? `${(amt / 10_000_000n).toString()}${amt % 10_000_000n ? "." + (amt % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "") : ""} ${label}` : `${amt} units of ${shortKey(r.address)}`;
      return [REQUEST_NAMES[Number(r.request_type)] ?? "Request", value];
    });
    rows.push(["From", shortKey(String(from))]);
    if (spender !== from) rows.push(["Spender", shortKey(String(spender))]);
    rows.push(["To", to === from ? "Same account" : shortKey(String(to))]);
    return rows;
  } catch {
    return [];
  }
}

function units(amount: bigint, label: string | null): string {
  if (!label) return amount.toString();
  const whole = amount / 10_000_000n, frac = amount % 10_000_000n;
  return `${whole}${frac ? "." + frac.toString().padStart(7, "0").replace(/0+$/, "") : ""} ${label}`;
}

/** DeFindex vault deposit/withdraw, decoded only when argument shapes match the vault interface. */
function describeVaultArgs(fname: string, args: unknown[]): { title: string; rows: [string, string][] } | null {
  try {
    const native = (args as never[]).map(a => scValToNative(a));
    const isAmounts = (v: unknown): v is bigint[] => Array.isArray(v) && v.every(x => typeof x === "bigint");
    if (fname === "deposit" && native.length === 4 && isAmounts(native[0]) && isAmounts(native[1]) && typeof native[2] === "string" && typeof native[3] === "boolean") {
      return { title: "Vault deposit", rows: [
        ["Amounts", native[0].map(a => units(a, null)).join(", ") + " (base units)"],
        ["Minimum accepted", native[1].map(a => units(a, null)).join(", ")],
        ["From", shortKey(native[2])],
        ["Invest into strategies", native[3] ? "Yes" : "No"]
      ] };
    }
    if (fname === "withdraw" && native.length === 3 && typeof native[0] === "bigint" && isAmounts(native[1]) && typeof native[2] === "string") {
      return { title: "Vault withdrawal", rows: [
        ["Shares", native[0].toString()],
        ["Minimum received", native[1].map(a => units(a, null)).join(", ") + " (base units)"],
        ["To", shortKey(native[2])]
      ] };
    }
  } catch { /* not a vault call shape */ }
  return null;
}

export function shortKey(key: string) {
  return key.length > 14 ? `${key.slice(0, 6)}…${key.slice(-6)}` : key;
}

export function assetLabel(asset: Asset): string {
  return asset.isNative() ? "XLM" : `${asset.getCode()} · ${shortKey(asset.getIssuer() ?? "")}`;
}

function amount(value: string) {
  // Normalise 7-decimal strings without float rounding.
  const stroops = toStroops(value);
  const whole = stroops / 10_000_000n;
  const frac = (stroops % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

function describePredicate(predicate: unknown): string {
  const p = predicate as { type?: string; absBefore?: unknown; relBefore?: unknown; notPredicate?: unknown; andPredicates?: unknown[]; orPredicates?: unknown[] } | null;
  if (!p || p.type === "claimPredicateUnconditional") return "Any time";
  if (p.type === "claimPredicateBeforeAbsoluteTime") return `Before ${new Date(Number(p.absBefore) * 1000).toLocaleString()}`;
  if (p.type === "claimPredicateBeforeRelativeTime") return `Within ${Number(p.relBefore)} s of creation`;
  if (p.type === "claimPredicateNot") return `Not (${describePredicate(p.notPredicate)})`;
  if (p.type === "claimPredicateAnd") return (p.andPredicates ?? []).map(describePredicate).join(" and ");
  if (p.type === "claimPredicateOr") return (p.orPredicates ?? []).map(describePredicate).join(" or ");
  return "Conditional";
}

export function describeOperation(op: Operation, txSource: string): DescribedOperation {
  const o = op as Operation & Record<string, unknown>;
  const rows: [string, string][] = [];
  const src = o.source as string | undefined;
  if (src && src !== txSource) rows.push(["From account", shortKey(src)]);
  switch (o.type) {
    case "payment":
      return { title: "Send payment", rows: [...rows, ["Amount", `${amount(o.amount as string)} ${assetLabel(o.asset as Asset)}`], ["To", shortKey(o.destination as string)]] };
    case "createAccount":
      return { title: "Create account", rows: [...rows, ["Account", shortKey(o.destination as string)], ["Starting balance", `${amount(o.startingBalance as string)} XLM`]] };
    case "pathPaymentStrictSend":
      return { title: "Swap", rows: [...rows,
        ["You pay", `${amount(o.sendAmount as string)} ${assetLabel(o.sendAsset as Asset)}`],
        ["Minimum received", `${amount(o.destMin as string)} ${assetLabel(o.destAsset as Asset)}`],
        ["Recipient", o.destination === txSource ? "Your account" : shortKey(o.destination as string)]] };
    case "pathPaymentStrictReceive":
      return { title: "Swap", rows: [...rows,
        ["You receive", `${amount(o.destAmount as string)} ${assetLabel(o.destAsset as Asset)}`],
        ["Maximum paid", `${amount(o.sendMax as string)} ${assetLabel(o.sendAsset as Asset)}`],
        ["Recipient", o.destination === txSource ? "Your account" : shortKey(o.destination as string)]] };
    case "changeTrust": {
      const line = o.line as Asset;
      const limit = o.limit as string;
      const removing = toStroops(limit) === 0n;
      return { title: removing ? "Remove trustline" : "Add trustline", rows: [...rows, ["Asset", line instanceof Asset ? assetLabel(line) : "Liquidity pool share"], ...(removing ? [] : [["Reserve", "0.5 XLM"] as [string, string]])] };
    }
    case "createClaimableBalance": {
      const claimants = (o.claimants as { destination: string; predicate: unknown }[]);
      return { title: "Lock funds in a claimable balance", rows: [...rows,
        ["Amount", `${amount(o.amount as string)} ${assetLabel(o.asset as Asset)}`],
        ...claimants.map((c, i) => [`Claimant ${i + 1}`, `${c.destination === txSource ? "You" : shortKey(c.destination)} · ${describePredicate(c.predicate)}`] as [string, string])] };
    }
    case "claimClaimableBalance":
      return { title: "Claim balance", rows: [...rows, ["Balance ID", shortKey(o.balanceId as string)]] };
    case "manageData":
      return { title: o.value === undefined || o.value === null ? "Remove account data" : "Set account data", rows: [...rows, ["Name", String(o.name)], ...(o.value ? [["Value", Buffer.from(o.value as Uint8Array).toString("utf8")] as [string, string]] : [])] };
    case "setOptions": {
      const r: [string, string][] = [];
      const flagNames = (f: number) => [f & 1 && "authorization required", f & 2 && "revocable", f & 4 && "immutable", f & 8 && "clawback"].filter(Boolean).join(", ");
      if (o.masterWeight === 0 && o.signer === undefined) {
        return { title: "Lock issuer (permanent fixed supply)", rows: [...rows, ["Effect", "No more of this asset can ever be issued"]] };
      }
      if (o.homeDomain !== undefined) r.push(["Home domain", String(o.homeDomain) || "(cleared)"]);
      if (o.setFlags !== undefined) r.push(["Issuer controls", flagNames(Number(o.setFlags)) || "none"]);
      if (o.clearFlags !== undefined) r.push(["Remove controls", flagNames(Number(o.clearFlags)) || "none"]);
      if (o.masterWeight !== undefined) r.push(["Master key weight", String(o.masterWeight)]);
      if (o.signer !== undefined) r.push(["Signer change", "Yes"]);
      return { title: "Change account settings", rows: [...rows, ...r] };
    }
    case "manageSellOffer":
      return { title: "Place sell offer", rows: [...rows, ["Selling", `${amount(o.amount as string)} ${assetLabel(o.selling as Asset)}`], ["Price", `${o.price} ${assetLabel(o.buying as Asset)} each`]] };
    case "accountMerge":
      return { title: "Close account", rows: [...rows, ["Remaining XLM to", o.destination === txSource ? "Your account" : shortKey(o.destination as string)]] };
    case "setTrustLineFlags":
      return { title: "Authorize holder", rows: [...rows, ["Asset", assetLabel(o.asset as Asset)], ["Holder", o.trustor === txSource ? "You" : shortKey(o.trustor as string)]] };
    case "invokeHostFunction": {
      const fn = o.func as unknown as { type: string; invokeContract?: { contractAddress: unknown; functionName: unknown; args: unknown[] } };
      if (fn.type === "hostFunctionTypeInvokeContract" && fn.invokeContract) {
        let contract = "unknown";
        try { contract = Address.fromScAddress(fn.invokeContract.contractAddress as never).toString(); } catch { /* keep unknown */ }
        const fname = String(fn.invokeContract.functionName);
        const vault = describeVaultArgs(fname, (fn.invokeContract as unknown as { args: unknown[] }).args ?? []);
        if (vault) return { title: vault.title, rows: [...rows, ["Vault", shortKey(contract)], ...vault.rows] };
        const extra = fname === "submit" ? describeSubmitArgs((fn.invokeContract as unknown as { args: unknown[] }).args ?? []) : [];
        return { title: fname === "submit" && extra.length ? "Lending pool request" : "Contract call", rows: [...rows, ["Contract", shortKey(contract)], ["Function", fname], ...extra] };
      }
      if (fn.type === "hostFunctionTypeUploadContractWasm") {
        const wasm = (fn as unknown as { wasm?: Uint8Array }).wasm;
        const h = wasm ? Buffer.from(hash(Buffer.from(wasm))).toString("hex") : "";
        return { title: "Install contract code", rows: [...rows,
          ["Code", h === NEXORA_TOKEN_WASM_HASH ? "NEXORA fixed-supply token" : "Unrecognised code"],
          ["Code hash", h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "—"], ["Size", wasm ? `${(wasm.length / 1024).toFixed(1)} KB` : "—"]] };
      }
      if (fn.type === "hostFunctionTypeCreateContractV2") {
        const c = (fn as unknown as { createContractV2: { contractIdPreimage: { fromAddress?: { address: unknown; salt: unknown } }; executable: { wasmHash?: { value?: Uint8Array } | Uint8Array }; constructorArgs: unknown[] } }).createContractV2;
        const wh = c.executable.wasmHash instanceof Uint8Array ? c.executable.wasmHash : c.executable.wasmHash?.value;
        const isToken = wh ? Buffer.from(wh).toString("hex") === NEXORA_TOKEN_WASM_HASH : false;
        const out: [string, string][] = [...rows];
        try {
          const deployer = Address.fromScAddress(c.contractIdPreimage.fromAddress!.address as never).toString();
          const saltV = c.contractIdPreimage.fromAddress!.salt as { value?: Uint8Array } | Uint8Array;
          const salt = saltV instanceof Uint8Array ? saltV : saltV.value!;
          out.push(["New contract", shortKey(predictContractId(deployer, salt))]);
        } catch { /* preimage not from an address */ }
        if (isToken) {
          try {
            const [name, symbol, decimals, recipient, supply] = (c.constructorArgs as never[]).map(a => scValToNative(a)) as [string, string, number, string, bigint];
            const base = 10n ** BigInt(decimals);
            const whole = BigInt(supply) / base, frac = BigInt(supply) % base;
            out.push(["Token", `${name} (${symbol})`], ["Decimals", String(decimals)],
              ["Fixed supply", `${whole}${frac ? "." + frac.toString().padStart(decimals, "0").replace(/0+$/, "") : ""} ${symbol}`],
              ["Minted to", recipient === txSource ? "You" : shortKey(recipient)]);
          } catch { /* unexpected args */ }
        } else out.push(["Code", "Unrecognised code"]);
        return { title: isToken ? "Deploy token contract" : "Deploy contract", rows: out };
      }
      return { title: "Deploy contract", rows };
    }
    default:
      return { title: String(o.type), rows };
  }
}

export function describeTransaction(tx: Transaction): DescribedTransaction {
  const memo = tx.memo.type === "none" ? null
    : tx.memo.value instanceof Uint8Array ? Buffer.from(tx.memo.value).toString(tx.memo.type === "hash" || tx.memo.type === "return" ? "hex" : "utf8")
    : String(tx.memo.value);
  return {
    hash: Buffer.from(tx.hash()).toString("hex"),
    source: tx.source,
    fee: amount((Number(tx.fee) / 1e7).toFixed(7)),
    validUntil: tx.timeBounds?.maxTime ? Number(tx.timeBounds.maxTime) : null,
    memo,
    operations: tx.operations.map(op => describeOperation(op, tx.source))
  };
}
