import { describe, expect, it } from "vitest";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { buildClassicLaunch, buildStellarToml, LaunchError, type LaunchRequest } from "@/lib/stellar/launch";
import { guardTransaction, TxGuardError } from "@/lib/stellar/tx-guard";
import { describeTransaction } from "@/lib/stellar/describe";
import type { AccountState } from "@/lib/stellar/swap";

const NOW = 1_800_000_000_000;
const me = Keypair.random().publicKey();
const team = Keypair.random().publicKey();
const acct = (xlm = "100"): AccountState => ({ id: me, sequence: "40", subentryCount: 0, numSponsoring: 0, numSponsored: 0, balances: [{ asset_type: "native", balance: xlm }] });
const base = (over: Partial<LaunchRequest> = {}): LaunchRequest => ({ account: acct(), code: "NEXO", totalSupply: "1000000", homeDomain: "nexo.example", authRequired: false, authRevocable: false, clawback: false, allocations: [], fixedSupply: false, feePerOperation: 100, now: NOW, ...over });
const err = (fn: () => unknown) => { try { fn(); return "ok"; } catch (e) { return e instanceof LaunchError ? e.code : e instanceof TxGuardError ? e.reason : String(e); } };

describe("classic launch", () => {
  it("issues to the wallet in one guarded transaction, co-signed by the new issuer", () => {
    const plan = buildClassicLaunch(base());
    const tx = guardTransaction(plan.xdr, { ...plan.intent, source: me }, NOW);
    expect(tx.operations.map(o => o.type)).toEqual(["createAccount", "setOptions", "changeTrust", "payment"]);
    expect(plan.assetId).toBe(`NEXO:${plan.issuerPublic}`);
    expect(Keypair.fromSecret(plan.issuerSecret).publicKey()).toBe(plan.issuerPublic);
    tx.sign(Keypair.fromSecret(plan.issuerSecret));
    expect(TransactionBuilder.fromXDR(tx.toXDR(), Networks.PUBLIC).signatures).toHaveLength(1);
    expect(plan.summary.creatorAmount).toBe("1000000");
  });

  it("vesting: cliff + monthly tranches as time-locked claimable balances; fixed supply locks the issuer", () => {
    const plan = buildClassicLaunch(base({ allocations: [{ address: team, percent: 10, cliffMonths: 6, durationMonths: 12 }], fixedSupply: true }));
    const tx = guardTransaction(plan.xdr, { ...plan.intent, source: me }, NOW);
    const types = tx.operations.map(o => o.type);
    expect(types.filter(t => t === "createClaimableBalance")).toHaveLength(12);
    expect(types.at(-1)).toBe("setOptions");
    expect(plan.summary.creatorAmount).toBe("900000");
    const total = plan.summary.allocations.reduce((s, a) => s + Number(a.amount), 0);
    expect(total).toBe(100000);
    const first = plan.summary.allocations[0].unlocksAt!;
    expect(first).toBe(NOW / 1000 + 7 * 30 * 86400);
    const described = describeTransaction(tx);
    expect(described.operations.at(-1)!.title).toMatch(/Lock issuer/);
  });

  it("optional initial DEX listing places a sell offer from the creator amount", () => {
    const plan = buildClassicLaunch(base({ listing: { amount: "50000", priceXlm: "0.02" } }));
    const tx = guardTransaction(plan.xdr, { ...plan.intent, source: me }, NOW);
    expect(tx.operations.at(-1)!.type).toBe("manageSellOffer");
    expect(describeTransaction(tx).operations.at(-1)!.rows).toEqual([["Selling", `50000 NEXO · ${plan.issuerPublic.slice(0, 6)}…${plan.issuerPublic.slice(-6)}`], ["Price", "0.02 XLM each"]]);
    expect(err(() => buildClassicLaunch(base({ listing: { amount: "2000000", priceXlm: "0.02" } })))).toBe("invalid_listing");
    expect(err(() => buildClassicLaunch(base({ listing: { amount: "10", priceXlm: "0" } })))).toBe("invalid_listing");
    const other = buildClassicLaunch(base({ listing: { amount: "50000", priceXlm: "0.01" }, issuer: Keypair.fromSecret(plan.issuerSecret) }));
    expect(err(() => guardTransaction(other.xdr, { ...plan.intent, source: me }, NOW))).toBe("op_4_price_mismatch");
  });

  it("authorization-required assets authorise the wallet trustline", () => {
    const plan = buildClassicLaunch(base({ authRequired: true, authRevocable: true }));
    const tx = guardTransaction(plan.xdr, { ...plan.intent, source: me }, NOW);
    expect(tx.operations.map(o => o.type)).toContain("setTrustLineFlags");
  });

  it("validates inputs and balance", () => {
    expect(err(() => buildClassicLaunch(base({ code: "TOO-LONG-CODE!" })))).toBe("invalid_code");
    expect(err(() => buildClassicLaunch(base({ code: "XLM" })))).toBe("invalid_code");
    expect(err(() => buildClassicLaunch(base({ totalSupply: "0" })))).toBe("invalid_supply");
    expect(err(() => buildClassicLaunch(base({ totalSupply: "922337203686" })))).toBe("invalid_supply");
    expect(err(() => buildClassicLaunch(base({ homeDomain: "not a domain" })))).toBe("invalid_domain");
    expect(err(() => buildClassicLaunch(base({ clawback: true })))).toBe("clawback_requires_revocable");
    expect(err(() => buildClassicLaunch(base({ allocations: [{ address: team, percent: 100, cliffMonths: 0, durationMonths: 0 }] })))).toBe("allocation_over_100");
    expect(err(() => buildClassicLaunch(base({ allocations: [{ address: me, percent: 5, cliffMonths: 0, durationMonths: 0 }] })))).toBe("invalid_allocation");
    expect(err(() => buildClassicLaunch(base({ account: acct("2.5") })))).toBe("insufficient_balance");
  });

  it("guard refuses master-weight changes that were not explicitly declared, or on the wallet itself", () => {
    const locked = buildClassicLaunch(base({ fixedSupply: true, issuer: Keypair.fromSecret(Keypair.random().secret()) }));
    const unlockedIntent = { ...locked.intent, operations: locked.intent.operations.slice(0, -1) };
    expect(err(() => guardTransaction(locked.xdr, { ...unlockedIntent, source: me }, NOW))).toBe("operation_count_mismatch");
    const ops = [...locked.intent.operations];
    ops[ops.length - 1] = { type: "setOptions", masterWeight: 0 }; // claims it's on the wallet itself
    expect(err(() => guardTransaction(locked.xdr, { ...locked.intent, operations: ops, source: me }, NOW))).toBe("op_4_source_mismatch");
  });

  it("generates a stellar.toml with escaped values", () => {
    const toml = buildStellarToml({ code: "NEXO", issuer: "GABC", name: 'Nexo "Coin"', description: "line\nbreak", fixedSupply: true });
    expect(toml).toContain('name="Nexo \\"Coin\\""');
    expect(toml).toContain('desc="line\\nbreak"');
    expect(toml).toContain("fixed_number=true");
  });
});
