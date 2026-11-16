// Trading acceptance beyond the happy path: asset identity (same code, different issuers),
// verified-icon vs fallback rendering, failed and unconfirmed swaps. Mocked responses only.
import { createRequire } from "node:module";
import { BASE, createWallet, loadPlaywright, reporter } from "./lib.mjs";
const require = createRequire(import.meta.url);
const { Networks, TransactionBuilder } = require("@stellar/stellar-sdk");
const { chromium } = loadPlaywright();
const rep = reporter();
const CIRCLE = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const FAKE = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");

let address = "", submitMode = "failed", txLookups = 0;
const iconRequests = [], pathRequests = [], submissions = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.route("**/api/stellar/**", async route => {
  const u = new URL(route.request().url());
  switch (u.pathname) {
    case "/api/stellar/account": return route.fulfill({ json: { account: { account_id: address, sequence: "5", subentry_count: 0 }, balances: [{ asset_type: "native", balance: "100.0000000", selling_liabilities: "0" }] } });
    case "/api/stellar/assets": return route.fulfill({ json: { assets: [{ asset_code: "USDC", asset_issuer: CIRCLE, num_accounts: "900000" }, { asset_code: "USDC", asset_issuer: FAKE, num_accounts: "12" }] } });
    case "/api/stellar/asset-icon": {
      const a = u.searchParams.get("asset"); iconRequests.push(a);
      return a.endsWith(CIRCLE) ? route.fulfill({ body: PNG, contentType: "image/png" }) : route.fulfill({ status: 404, body: "" });
    }
    case "/api/stellar/paths": pathRequests.push(u.searchParams.get("destAsset")); return route.fulfill({ json: { routes: [{ destAmount: "2.5", path: [] }], retrievedAt: new Date().toISOString() } });
    case "/api/stellar/fee": return route.fulfill({ json: { perOperation: 100 } });
    case "/api/stellar/submit": {
      const tx = TransactionBuilder.fromXDR(route.request().postDataJSON().xdr, Networks.PUBLIC); submissions.push(tx);
      const hash = Buffer.from(tx.hash()).toString("hex");
      return route.fulfill({ json: submitMode === "failed" ? { status: "failed", hash, code: "op_under_dest_min" } : { status: "pending", hash } });
    }
    case "/api/stellar/tx": txLookups++; return route.fulfill({ json: { status: "confirmed", hash: u.searchParams.get("hash") } });
    default: return route.fulfill({ status: 502, json: { error: "x" } });
  }
});

await page.goto(BASE + "/swap", { waitUntil: "networkidle" });
({ address } = await createWallet(page));

// Identity: pick the non-Circle USDC explicitly
await page.locator(".nx-swap-input-box.receive .nx-swap-field-main > button").click();
await page.getByPlaceholder("Search asset code…").fill("USDC");
const fakeRow = page.getByRole("button", { name: `USDC, issuer ${FAKE}` });
const circleRow = page.getByRole("button", { name: new RegExp(`USDC, issuer ${CIRCLE}`) });
await fakeRow.waitFor();
rep.check("same code, different issuers listed separately", await circleRow.isVisible() && await fakeRow.isVisible());
rep.check("verified icon shown only for domain-linked asset", (await circleRow.locator("img").count()) === 1 && (await fakeRow.locator("img").count()) === 0);
await fakeRow.click();
await page.getByText(/Issuer: GBBD47/).first().waitFor();
rep.check("previous pair's quote cleared immediately", (await page.locator(".nx-swap-output").innerText()).trim() === "—");
await page.waitForResponse(r => r.url().includes("/api/stellar/paths") && r.url().includes(FAKE));
await page.locator(".nx-swap-output", { hasText: "2.5" }).waitFor();
rep.check("quote requested for the exact issuer chosen", pathRequests.at(-1) === `USDC:${FAKE}`, JSON.stringify(pathRequests));

// Failed swap
await page.getByRole("button", { name: "Review swap" }).click();
const sheet = page.getByRole("dialog", { name: "Approve transaction" });
await sheet.waitFor();
rep.check("approval sheet names the chosen issuer", (await sheet.innerText()).includes("USDC · GBBD47…3ZLLFLA5".replace("3ZLLFLA5", FAKE.slice(-6))));
await page.waitForTimeout(700); await sheet.getByRole("button", { name: /Approve/ }).click();
await page.getByText("The price moved beyond your slippage limit. Review the swap again.").waitFor();
rep.check("failed swap: actionable message, no success claim", !(await page.getByText("Confirmed on Stellar.").isVisible()));
const destOf = tx => tx.operations.at(-1).destAsset;
rep.check("signed swap targets the exact issuer", destOf(submissions[0]).getIssuer() === FAKE);
await page.getByRole("button", { name: "Close" }).last().click();

// Server can't confirm quickly → browser polls the ledger; success only once the lookup confirms
submitMode = "pending";
await page.getByRole("button", { name: "Review swap" }).click();
await sheet.waitFor(); await page.waitForTimeout(700); await sheet.getByRole("button", { name: /Approve/ }).click();
await page.getByText("Confirmed on Stellar.").waitFor();
rep.check("pending submit confirmed only via ledger lookup of the same hash", txLookups >= 1);
rep.print();
await browser.close();
