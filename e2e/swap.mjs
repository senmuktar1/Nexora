// Swap acceptance: real UI + real wallet + real guard/signing; Stellar API responses mocked.
// No request leaves the machine; nothing is broadcast.
import { createRequire } from "node:module";
import { BASE, createWallet, loadPlaywright, reporter } from "./lib.mjs";
const require = createRequire(import.meta.url);
const { Keypair, Networks, TransactionBuilder } = require("@stellar/stellar-sdk");
const { chromium } = loadPlaywright();
const rep = reporter();
const USDC = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
let address = "";
const submissions = [];
await page.route("**/api/stellar/**", async route => {
  const url = new URL(route.request().url());
  const p = url.pathname;
  if (p === "/api/stellar/account") return route.fulfill({ json: {
    account: { account_id: address, sequence: "123456789", subentry_count: 0, num_sponsoring: 0, num_sponsored: 0 },
    balances: [{ asset_type: "native", asset_code: "XLM", balance: "100.0000000", selling_liabilities: "0", buying_liabilities: "0" }],
    transactions: [], offers: [], retrievedAt: new Date().toISOString() } });
  if (p === "/api/stellar/paths") return route.fulfill({ json: { routes: [{ sendAmount: url.searchParams.get("sendAmount"), destAmount: "2.5", path: [] }], retrievedAt: new Date().toISOString() } });
  if (p === "/api/stellar/fee") return route.fulfill({ json: { perOperation: 100 } });
  if (p === "/api/stellar/submit") {
    const { xdr } = route.request().postDataJSON();
    submissions.push(xdr);
    const tx = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC);
    return route.fulfill({ json: { status: "confirmed", hash: Buffer.from(tx.hash()).toString("hex"), ledger: 1 } });
  }
  return route.fulfill({ status: 502, json: { error: "Temporarily unavailable." } });
});

await page.goto(BASE + "/swap", { waitUntil: "networkidle" });
({ address } = await createWallet(page));
await page.getByText("Balance: 100 XLM", { exact: true }).waitFor();
rep.check("balance shown from account data", true);
await page.locator(".nx-swap-output", { hasText: "2.5" }).waitFor();
rep.check("live quote rendered", true);

// 1) Reject → nothing submitted
await page.getByRole("button", { name: "Review swap" }).click();
const sheet = page.getByRole("dialog", { name: "Approve transaction" });
await sheet.waitFor();
const sheetText = await sheet.textContent();
rep.check("sheet decodes trustline op", /Add trustline/.test(sheetText));
rep.check("sheet shows exact send amount", /You pay10 XLM/.test(sheetText));
rep.check("sheet shows min received with issuer", /Minimum received2\.475 USDC · GA5ZSE…K4KZVN/.test(sheetText), sheetText.match(/Minimum received[^N]*/)?.[0]);
rep.check("sheet shows fee", /Network fee \(max\)0\.00002 XLM/.test(sheetText));
rep.check("approve is armed only after delay", await sheet.getByRole("button", { name: /Approve/ }).isDisabled());
await sheet.getByRole("button", { name: "Reject" }).click();
await page.waitForTimeout(500);
rep.check("reject → no submission", submissions.length === 0);

// 2) Approve → signed, submitted, confirmed
await page.getByRole("button", { name: "Review swap" }).click();
await sheet.waitFor();
await page.waitForTimeout(700);
await sheet.getByRole("button", { name: /Approve/ }).click();
await page.getByText("Confirmed on Stellar.").waitFor({ timeout: 10000 }).catch(async () => { console.log("DIALOG:", await page.locator(".nx-wallet-dialog").allTextContents()); throw new Error("not confirmed"); });
rep.check("confirmation shown only after confirmed response", submissions.length === 1);

const tx = TransactionBuilder.fromXDR(submissions[0], Networks.PUBLIC);
const sig = tx.signatures[0];
rep.check("exactly one signature", tx.signatures.length === 1);
rep.check("signature valid for wallet key", Keypair.fromPublicKey(address).verify(tx.hash(), Buffer.from(sig.signature.value ?? sig.signature())));
rep.check("source & sequence", tx.source === address && tx.sequence === "123456790");
const [ct, pp] = tx.operations;
rep.check("signed ops match sheet", ct.type === "changeTrust" && pp.type === "pathPaymentStrictSend" && pp.sendAmount === "10.0000000" && pp.destMin === "2.4750000" && pp.destination === address && `${pp.destAsset.getCode()}:${pp.destAsset.getIssuer()}` === USDC);
rep.check("fee matches sheet", tx.fee === "200");

// 3) Locked wallet → unlock required before any approval sheet
await page.getByRole("button", { name: "Done" }).click();
await page.locator(".nx-wallet-connected").click();
await page.getByRole("button", { name: /Lock wallet/ }).click();
await page.getByRole("button", { name: "Review swap" }).click();
await page.getByRole("dialog", { name: "Wallet" }).waitFor();
rep.check("locked wallet prompts unlock before signing", !(await sheet.isVisible()));

rep.print();
await browser.close();
