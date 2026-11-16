// DeFindex acceptance: vault position, deposit and withdraw through the approval sheet;
// a tampered server build (lower minimum) is refused. Stellar/DeFindex responses mocked.
import { createRequire } from "node:module";
import { BASE, createWallet, loadPlaywright, reporter } from "./lib.mjs";
const require = createRequire(import.meta.url);
const { Account, Asset, Contract, Networks, TransactionBuilder, xdr, scValToNative } = require("@stellar/stellar-sdk");
const { chromium } = loadPlaywright();
const rep = reporter();

const VAULT = "CCCCIQSDILITHMM7PBSLVDT5MISSY7R26MNZXCX4H7J5JQ5FPIYOGYFS";
const USDC = new Asset("USDC", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN").contractId(Networks.PUBLIC);
let address = "", tamper = false;
const submissions = [];
function built(body) {
  const scv = [];
  const i128 = v => xdr.ScVal.fromXDR(require("@stellar/stellar-sdk").nativeToScVal(BigInt(v), { type: "i128" }).toXDR("base64"), "base64");
  const { nativeToScVal, Address } = require("@stellar/stellar-sdk");
  if (body.action === "deposit") {
    const mins = tamper ? body.amountsMin.map(() => "0") : body.amountsMin;
    scv.push(xdr.ScVal.scvVec(body.amounts.map(i128)), xdr.ScVal.scvVec(mins.map(i128)), new Address(body.wallet).toScVal(), nativeToScVal(true));
  } else {
    scv.push(i128(body.shares), xdr.ScVal.scvVec(body.minAmountsOut.map(i128)), new Address(body.wallet).toScVal());
  }
  return new TransactionBuilder(new Account(address, "40"), { fee: "300000", networkPassphrase: Networks.PUBLIC, timebounds: { minTime: 0, maxTime: Math.floor(Date.now() / 1000) + 170 } })
    .addOperation(new Contract(VAULT).call(body.action, ...scv)).build().toEnvelope().toXDR("base64");
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await page.route("**/api/stellar/**", async route => {
  const u = new URL(route.request().url());
  switch (u.pathname) {
    case "/api/stellar/defindex": return route.fulfill({ json: { network: "mainnet", source: "x", retrievedAt: new Date().toISOString(), totalVaults: 1, vaults: [{ address: VAULT, name: "USDC Blend Vault", symbol: "dfUSDC", apy: 5.1 }], strategies: [], errors: { vaults: null, strategies: null } } });
    case "/api/stellar/defindex/position": {
      const shares = u.searchParams.get("shares");
      return route.fulfill({ json: { vault: VAULT, assets: [{ address: USDC, symbol: "USDC", decimals: 7 }], totalShares: "100000000000", userShares: u.searchParams.get("wallet") ? "1000000000" : null, userAmounts: ["1010000000"], amountsForShares: shares ? [String(BigInt(shares) * 101n / 100n)] : null } });
    }
    case "/api/stellar/defindex/build": return route.fulfill({ json: { xdr: built(route.request().postDataJSON()) } });
    case "/api/stellar/submit": {
      const tx = TransactionBuilder.fromXDR(route.request().postDataJSON().xdr, Networks.PUBLIC); submissions.push(tx);
      return route.fulfill({ json: { status: "confirmed", hash: Buffer.from(tx.hash()).toString("hex") } });
    }
    default: return route.fulfill({ status: 503, json: { error: "Temporarily unavailable." } });
  }
});

await page.goto(BASE + "/lend", { waitUntil: "networkidle" });
({ address } = await createWallet(page));
await page.getByRole("button", { name: /Explore vaults/ }).first().click();
await page.locator(".nx-lending-defindex-inspect").first().click();
await page.locator(".nx-defindex-actions").getByText("Your shares").waitFor();
const panel = page.locator(".nx-defindex-actions");
rep.check("position shows on-chain shares and underlying balance", /1000000000/.test(await panel.innerText()) && /101 USDC/.test(await panel.innerText()));

// Deposit 25 USDC with 0.5% slippage
await panel.getByPlaceholder("0.00").fill("25");
await panel.getByRole("button", { name: /^Deposit$/ }).last().click();
const sheet = page.getByRole("dialog", { name: "Approve transaction" });
await sheet.waitFor();
const t = await sheet.innerText();
rep.check("sheet decodes vault deposit from XDR", /Vault deposit/.test(t) && /250000000 \(base units\)/.test(t) && /Minimum accepted\s*248750000/.test(t));
await page.waitForTimeout(700); await sheet.getByRole("button", { name: /Approve/ }).click();
await panel.getByText(/Deposit confirmed/).waitFor();
const dep = submissions[0];
rep.check("deposit signed by wallet; args = [250000000], [248750000], wallet, invest", dep.signatures.length === 1 &&
  JSON.stringify(dep.operations[0].func.invokeContract.args.map(a => String(scValToNative(a)))) === JSON.stringify(["250000000", "248750000", address, "true"]));

// Withdraw 50% of shares
await panel.getByRole("tab", { name: "Withdraw" }).click();
await panel.getByRole("button", { name: "50%" }).click();
await panel.getByRole("button", { name: /^Withdraw$/ }).last().click();
await sheet.waitFor();
const w = await sheet.innerText();
rep.check("sheet decodes vault withdrawal (shares + minimum)", /Vault withdrawal/.test(w) && /Shares\s*500000000/.test(w) && /Minimum received\s*502475000/.test(w));
await page.waitForTimeout(700); await sheet.getByRole("button", { name: /Approve/ }).click();
await panel.getByText(/Withdrawal confirmed/).waitFor();
rep.check("withdraw submitted after confirmation only", submissions.length === 2);

// Tampered build: server lowers amounts_min to 0 → refused, nothing submitted
tamper = true;
await panel.getByRole("tab", { name: "Deposit" }).click();
await panel.getByPlaceholder("0.00").fill("10");
await panel.getByRole("button", { name: /^Deposit$/ }).last().click();
await panel.getByText("This transaction did not match what you reviewed, so it was not signed.").waitFor();
rep.check("tampered build refused before approval; nothing submitted", !(await sheet.isVisible()) && submissions.length === 2);
rep.print();
await browser.close();
