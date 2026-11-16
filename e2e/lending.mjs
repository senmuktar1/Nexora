// Lending acceptance (Blend): server-built Soroban tx must match the client's own request
// encoding before the approval sheet appears; tampered builds are refused. Mocked responses only.
import { createRequire } from "node:module";
import { BASE, createWallet, loadPlaywright, reporter } from "./lib.mjs";
const require = createRequire(import.meta.url);
const { Account, Asset, Keypair, Networks, TransactionBuilder, xdr } = require("@stellar/stellar-sdk");
const { PoolContractV2, RequestType } = require("@blend-capital/blend-sdk");
const { chromium } = loadPlaywright();
const rep = reporter();

const POOL = "CAJJZSGMMM3PD7N33TAPHGBUGTB43OC73HVIK2L2G6BNGGGYOSSYBXBD";
const USDC = new Asset("USDC", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN").contractId(Networks.PUBLIC);
const reserve = { assetContract: USDC, symbol: "USDC", name: "USD Coin", decimals: 7, tokenDecimals: 7, decimalsMatch: true, oraclePrice: 1, oracleValueSupplied: 1000000, oracleValueBorrowed: 500000, oracleLedger: 1, enabled: true,
  supplyApr: 0.05, borrowApr: 0.08, estimatedSupplyApy: 0.051, estimatedBorrowApy: 0.083, utilization: 0.5, supplied: 1000000, borrowed: 500000, collateralFactor: 0.9, liabilityFactor: 1.05, latestLedger: 1 };
const snapshot = { network: "mainnet", ledger: 1, retrievedAt: new Date().toISOString(), unavailable: [],
  pools: [{ id: POOL, label: "Fixed V2", name: "Fixed", version: "V2", status: 0, admin: "G", backstop: "C", oracle: "C", oracleLedger: 1, oracleReadAvailable: true, oracleReadError: null, wasmHash: "x", latestLedger: 1, reserves: [reserve] }] };

let address = "";
let buildCalls = 0;
const submissions = [];
function buildTx(amount) {
  const op = xdr.Operation.fromXDR(String(new PoolContractV2(POOL).submit({ from: address, spender: address, to: address,
    requests: [{ request_type: RequestType.SupplyCollateral, address: USDC, amount }] })), "base64");
  return new TransactionBuilder(new Account(address, "900"), { fee: "250000", networkPassphrase: Networks.PUBLIC, timebounds: { minTime: 0, maxTime: Math.floor(Date.now() / 1000) + 170 } })
    .addOperation(op).build().toEnvelope().toXDR("base64");
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await page.route("**/api/stellar/**", async route => {
  const p = new URL(route.request().url()).pathname;
  if (p === "/api/stellar/blend") return route.fulfill({ json: snapshot });
  if (p === "/api/stellar/blend/build") {
    buildCalls++;
    const body = route.request().postDataJSON();
    rep.check(`build #${buildCalls} request carries units, not display text`, body.units === "250000000" && body.wallet === address);
    // Call 1: honest. Call 2: a malicious/buggy server inflates the amount.
    return route.fulfill({ json: { xdr: buildTx(buildCalls === 1 ? 250000000n : 2500000000n), fee: "250000" } });
  }
  if (p === "/api/stellar/submit") {
    const tx = TransactionBuilder.fromXDR(route.request().postDataJSON().xdr, Networks.PUBLIC);
    submissions.push(tx);
    return route.fulfill({ json: { status: "confirmed", hash: Buffer.from(tx.hash()).toString("hex") } });
  }
  return route.fulfill({ status: 502, json: { error: "Temporarily unavailable." } });
});

await page.goto(BASE + "/lend", { waitUntil: "networkidle" });
({ address } = await createWallet(page));
const details = page.getByRole("button", { name: /Details/ }).first();
if (!(await details.isVisible().catch(() => false))) await page.getByRole("button", { name: /View markets/ }).first().click();
await details.click();
const amountInput = page.locator(".nx-blend-preflight input").first();
await amountInput.fill("25");
await page.getByRole("button", { name: /^Supply$/ }).click();

const sheet = page.getByRole("dialog", { name: "Approve transaction" });
await sheet.waitFor();
const text = await sheet.innerText();
rep.check("sheet decodes pool request from XDR", /Lending pool request/.test(text) && /Supply as collateral\s*25 USDC/.test(text) && /To\s*Same account/.test(text));
await page.waitForTimeout(700);
await sheet.getByRole("button", { name: /Approve/ }).click();
await page.getByText("Confirmed on Stellar.").waitFor();
const tx = submissions[0];
rep.check("submitted tx signed by wallet", tx.signatures.length === 1 && Keypair.fromPublicKey(address).verify(tx.hash(), Buffer.from(tx.signatures[0].signature.value ?? tx.signatures[0].signature())));
await page.getByRole("button", { name: "Done" }).click();

// Tampered build → refused before any approval sheet
await page.getByRole("button", { name: /^Supply$/ }).click();
await page.getByText("This transaction did not match what you reviewed, so it was not signed.").waitFor();
rep.check("tampered server build refused, no sheet shown", !(await sheet.isVisible()));
rep.check("nothing submitted for tampered build", submissions.length === 1);

rep.print();
await browser.close();
