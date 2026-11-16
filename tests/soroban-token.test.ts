import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { Account, Address, Keypair, Networks, nativeToScVal, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { buildDeployTx, buildUploadTx, constructorArgsBase64, loadTokenWasm, NEXORA_TOKEN_WASM_HASH, predictContractId, TokenError } from "@/lib/stellar/soroban-token";
import { guardTransaction, TxGuardError } from "@/lib/stellar/tx-guard";
import { describeTransaction } from "@/lib/stellar/describe";

const wasm = readFileSync("public/contracts/nexora-token.wasm");
const me = Keypair.random().publicKey();
const src = { id: me, sequence: "99" };
const NOW = 1_800_000_000_000;
const params = { name: "Nexo Coin", symbol: "NEXO", decimals: 7, recipient: me, supplyUnits: 1_000_000_0000000n };
const reason = (fn: () => unknown) => { try { fn(); return "ok"; } catch (e) { return e instanceof TxGuardError ? e.reason : e instanceof TokenError ? e.code : String(e); } };

describe("NEXORA token wasm", () => {
  it("served wasm matches the pinned Soroban wasm hash", () => {
    expect(createHash("sha256").update(wasm).digest("hex")).toBe(NEXORA_TOKEN_WASM_HASH);
  });
  it("loadTokenWasm refuses tampered bytes", async () => {
    const ok = await loadTokenWasm((async () => new Response(wasm)) as never);
    expect(ok.length).toBe(wasm.length);
    const bad = Buffer.from(wasm); bad[100] ^= 1;
    await expect(loadTokenWasm((async () => new Response(bad)) as never)).rejects.toMatchObject({ code: "wasm_mismatch" });
  });
});

describe("contract address prediction", () => {
  it("matches the Soroban host's derivation (Rust test vector)", () => {
    // contracts/nexora-token/src/test.rs::deterministic_contract_address_vector
    expect(predictContractId("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7", new Uint8Array(32).fill(7)))
      .toBe("CB7VA34YIV32PUFFNJ75CK6OCAXD3J4Z4Q42WNCMNTLTJJXBHUHPZRMP");
  });
});

describe("upload and deploy transactions", () => {
  it("upload: guard accepts only the pinned code", () => {
    const { xdr, intent } = buildUploadTx(src, wasm, NOW);
    const tx = guardTransaction(xdr, { ...intent, source: me }, NOW);
    expect(describeTransaction(tx).operations[0].rows).toContainEqual(["Code", "NEXORA fixed-supply token"]);
    const other = buildUploadTx(src, Buffer.concat([wasm, Buffer.from([0])]), NOW);
    expect(reason(() => guardTransaction(other.xdr, { ...intent, source: me }, NOW))).toBe("op_0_wasm_mismatch");
  });

  it("deploy: guard checks deployer, salt, wasm hash and every constructor argument", () => {
    const salt = randomBytes(32);
    const { xdr, intent, contractId } = buildDeployTx(src, params, salt, NOW);
    const tx = guardTransaction(xdr, { ...intent, source: me }, NOW);
    const d = describeTransaction(tx).operations[0];
    expect(d.title).toBe("Deploy token contract");
    expect(d.rows).toContainEqual(["Fixed supply", "1000000 NEXO"]);
    expect(d.rows).toContainEqual(["Minted to", "You"]);
    expect(d.rows).toContainEqual(["New contract", `${contractId.slice(0, 6)}…${contractId.slice(-6)}`]);

    const tamper = (p: Partial<typeof params>, s = salt) => buildDeployTx(src, { ...params, ...p }, s, NOW).xdr;
    expect(reason(() => guardTransaction(tamper({ supplyUnits: 2n }), { ...intent, source: me }, NOW))).toBe("op_0_args_mismatch");
    expect(reason(() => guardTransaction(tamper({ recipient: Keypair.random().publicKey() }), { ...intent, source: me }, NOW))).toBe("op_0_args_mismatch");
    expect(reason(() => guardTransaction(tamper({}, randomBytes(32)), { ...intent, source: me }, NOW))).toBe("op_0_salt_mismatch");
    // a different (e.g. mintable) contract code
    const evil = new TransactionBuilder(new Account(me, "99"), { fee: "1000", networkPassphrase: Networks.PUBLIC, timebounds: { minTime: 0, maxTime: NOW / 1000 + 100 } })
      .addOperation(Operation.createCustomContract({ address: new Address(me), wasmHash: Buffer.alloc(32, 1), salt, constructorArgs: [nativeToScVal("x")] })).build().toEnvelope().toXDR("base64");
    expect(reason(() => guardTransaction(evil, { ...intent, source: me }, NOW))).toBe("op_0_wasm_mismatch");
  });

  it("validates token parameters", () => {
    expect(reason(() => constructorArgsBase64({ ...params, symbol: "BAD SYMBOL" }))).toBe("invalid_symbol");
    expect(reason(() => constructorArgsBase64({ ...params, decimals: 19 }))).toBe("invalid_decimals");
    expect(reason(() => constructorArgsBase64({ ...params, supplyUnits: 0n }))).toBe("invalid_supply");
    expect(reason(() => buildDeployTx(src, params, new Uint8Array(31), NOW))).toBe("invalid_salt");
  });
});
