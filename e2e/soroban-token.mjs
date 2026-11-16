// Soroban token deployment acceptance (OpenZeppelin-based NEXORA token). Real wasm, real guard,
// real signing; Soroban RPC simulation and submission are mocked. Nothing is broadcast.
import { createRequire } from "node:module";
import { BASE, createWallet, loadPlaywright, reporter } from "./lib.mjs";
const require = createRequire(import.meta.url);
const { Address, hash, Networks, Operation, StrKey, TransactionBuilder, xdr, scValToNative, Account } = require("@stellar/stellar-sdk");
const { chromium } = loadPlaywright();
const rep = reporter();

let address = "", installed = false, tamperUpload = false;
const submissions = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await page.route("**/api/stellar/**", async route => {
  const p = new URL(route.request().url()).pathname;
  if (p === "/api/stellar/account") return route.fulfill({ json: { account: { account_id: address, sequence: String(1000 + submissions.length), subentry_count: 0 }, balances: [{ asset_type: "native", balance: "500.0000000" }] } });
  if (p === "/api/stellar/soroban/code-status") return route.fulfill({ json: { installed } });
  if (p === "/api/stellar/soroban/prepare") {
    let x = route.request().postDataJSON().xdr;
    if (tamperUpload) {
      const t = TransactionBuilder.fromXDR(x, Networks.PUBLIC);
      x = new TransactionBuilder(new Account(t.source, String(BigInt(t.sequence) - 1n)), { fee: "1000", networkPassphrase: Networks.PUBLIC, timebounds: { minTime: 0, maxTime: Math.floor(Date.now() / 1000) + 100 } })
        .addOperation(Operation.uploadContractWasm({ wasm: Buffer.from("a mintable token") })).build().toEnvelope().toXDR("base64");
    }
    return route.fulfill({ json: { kind: "x", xdr: x } });
  }
  if (p === "/api/stellar/submit") {
    const tx = TransactionBuilder.fromXDR(route.request().postDataJSON().xdr, Networks.PUBLIC); submissions.push(tx);
    return route.fulfill({ json: { status: "confirmed", hash: Buffer.from(tx.hash()).toString("hex") } });
  }
  return route.fulfill({ status: 503, json: { error: "Temporarily unavailable." } });
});

async function approve() {
  const sheet = page.getByRole("dialog", { name: "Approve transaction" });
  await sheet.waitFor();
  const t = await sheet.innerText();
  await page.waitForTimeout(700);
  await sheet.getByRole("button", { name: /Approve/ }).click();
  return t;
}
async function configure() {
  await page.getByRole("tab", { name: "Create asset" }).click();
  await page.getByRole("button", { name: /Soroban Token/ }).click();
  await page.getByRole("button", { name: /Next/ }).click();
  await page.getByPlaceholder("e.g. Stellar Community Fund").fill("Nexo Coin");
  await page.getByPlaceholder("e.g. NEX").fill("NEXO");
  await page.getByPlaceholder("Describe the purpose, issuer, rights and intended use…").fill("Community token.");
  await page.locator(".nx-launch-stage input[type=checkbox]").first().check();
  await page.getByRole("button", { name: /Next/ }).click();
  rep.check("classic-only distribution controls hidden for Soroban", (await page.locator(".nx-launch-advanced").count()) === 0 && (await page.getByText("QUICK PRESETS").count()) === 0);
  await page.getByPlaceholder("1,000,000,000").fill("1000000");
  await page.getByRole("button", { name: /Next/ }).click();
  rep.check("contract-enforced fixed supply explained; no dead toggles", /Fixed supply, enforced by the contract/.test(await page.locator(".nx-launch-stage").innerText()) && (await page.getByLabel("List on Stellar DEX").count()) === 0);
  await page.getByRole("button", { name: /Next/ }).click();
  await page.getByRole("button", { name: "Deploy token" }).click();
}

await page.goto(BASE + "/launch", { waitUntil: "networkidle" });
({ address } = await createWallet(page));
await configure();
const t1 = await approve();
rep.check("step 1 sheet: install NEXORA token code (recognised by hash)", /Install contract code/.test(t1) && /NEXORA fixed-supply token/.test(t1));
const t2 = await approve();
rep.check("step 2 sheet: deploy token with fixed supply minted to you", /Deploy token contract/.test(t2) && /Nexo Coin \(NEXO\)/.test(t2) && /Fixed supply\s*1000000 NEXO/.test(t2) && /Minted to\s*You/.test(t2));
await page.getByText("NEXO is live").waitFor();
const [up, dep] = submissions;
const wasmHash = Buffer.from(hash(Buffer.from(up.operations[0].func.wasm))).toString("hex");
rep.check("upload carries the pinned wasm", wasmHash === "80d27ccd6861a5045369c83d101eb964ae2a709f4443e5f75cf96726c5038878");
const c = dep.operations[0].func.createContractV2;
const args = c.constructorArgs.map(a => scValToNative(a));
rep.check("deploy constructor args exact", args[0] === "Nexo Coin" && args[1] === "NEXO" && args[2] === 7 && args[3] === address && String(args[4]) === "10000000000000");
const salt = c.contractIdPreimage.fromAddress.salt.value ?? c.contractIdPreimage.fromAddress.salt;
const pre = xdr.HashIdPreimage.envelopeTypeContractId(new xdr.HashIdPreimageContractId({ networkId: hash(Buffer.from(Networks.PUBLIC)),
  contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(new xdr.ContractIdPreimageFromAddress({ address: new Address(address).toScAddress(), salt: Buffer.from(salt) })) }));
const expectedId = StrKey.encodeContract(hash(pre.toXDR()));
rep.check("shown contract ID = ID derived from the signed deploy tx", (await page.locator(".nx-wallet-dialog .nx-wallet-code").innerText()).trim() === expectedId);
rep.check("both txs signed by the wallet only", submissions.every(t => t.signatures.length === 1));
await page.getByRole("button", { name: "Done" }).click();
await page.getByRole("tab", { name: "My launches" }).click();
await page.getByText("NEXO · Nexo Coin").waitFor();
rep.check("My launches records the Soroban token", /Soroban token/.test(await page.locator(".nx-voucher-mine-row").first().innerText()));

// Already installed → single approval
installed = true;
await configure();
await approve();
await page.getByText("NEXO is live").waitFor();
rep.check("code already installed → deploy only (one approval)", submissions.length === 3 && submissions[2].operations[0].func.type === "hostFunctionTypeCreateContractV2");
await page.getByRole("button", { name: "Done" }).click();

// Server swaps in different contract code → refused, nothing submitted
installed = false; tamperUpload = true;
await configure();
await page.getByText("This transaction did not match what you reviewed, so it was not signed.").waitFor();
rep.check("tampered code upload refused before approval", submissions.length === 3);
rep.print();
await browser.close();
