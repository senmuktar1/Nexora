// Launchpad acceptance: classic issuance with vesting, DEX listing and fixed supply.
// Real UI + wallet + guard + approval sheet; Stellar API responses mocked; nothing broadcast.
import { createRequire } from "node:module";
import { BASE, createWallet, loadPlaywright, reporter } from "./lib.mjs";
const require = createRequire(import.meta.url);
const { Keypair, Networks, TransactionBuilder } = require("@stellar/stellar-sdk");
const { chromium } = loadPlaywright();
const rep = reporter();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
let address = "";
const submissions = [];
await page.route("**/api/stellar/**", async route => {
  const p = new URL(route.request().url()).pathname;
  if (p === "/api/stellar/account") return route.fulfill({ json: { account: { account_id: address, sequence: "500", subentry_count: 0, num_sponsoring: 0, num_sponsored: 0 }, balances: [{ asset_type: "native", balance: "50.0000000", selling_liabilities: "0" }] } });
  if (p === "/api/stellar/fee") return route.fulfill({ json: { perOperation: 100 } });
  if (p === "/api/stellar/submit") {
    const tx = TransactionBuilder.fromXDR(route.request().postDataJSON().xdr, Networks.PUBLIC);
    submissions.push(tx);
    return route.fulfill({ json: { status: "confirmed", hash: Buffer.from(tx.hash()).toString("hex") } });
  }
  return route.fulfill({ status: 502, json: { error: "Temporarily unavailable." } });
});

await page.goto(BASE + "/launch", { waitUntil: "networkidle" });
({ address } = await createWallet(page));
await page.getByRole("tab", { name: "Create asset" }).click();

// Step 1: Soroban is gated, classic selected
await page.getByRole("button", { name: /Stellar Classic Asset/ }).click();
await page.getByRole("button", { name: /Next/ }).click();
// Step 2: identity
await page.getByPlaceholder("e.g. Stellar Community Fund").fill("Nexo Coin");
await page.getByPlaceholder("e.g. NEX").fill("NEXO");
await page.getByPlaceholder("Describe the purpose, issuer, rights and intended use…").fill("Community token.");
await page.getByPlaceholder("https://yourproject.org").fill("https://nexo.example");
await page.locator(".nx-launch-stage input[type=checkbox]").first().check();
await page.getByRole("button", { name: /Next/ }).click();
// Step 3: supply + vesting
await page.getByPlaceholder("1,000,000,000").fill("1000000");
await page.getByRole("button", { name: /Advanced Distribution/ }).click();
await page.getByRole("button", { name: /Add vesting/ }).click();
const team = Keypair.random().publicKey();
await page.locator(".nx-launch-vesting-edit input").nth(0).fill(team);
await page.locator(".nx-launch-vesting-edit input").nth(1).fill("10");
await page.locator(".nx-launch-vesting-edit input").nth(2).fill("6");
await page.locator(".nx-launch-vesting-edit input").nth(3).fill("4");
await page.getByRole("button", { name: /Next/ }).click();
// Step 4: fixed supply (default on) + DEX listing
rep.check("fixed supply on by default", await page.getByLabel("Fixed supply").isChecked());
await page.getByLabel("List on Stellar DEX").check();
await page.getByPlaceholder("0", { exact: true }).fill("50000");
await page.getByPlaceholder("0.01").fill("0.02");
await page.getByRole("button", { name: /Next/ }).click();
// Step 5
const body = await page.locator(".nx-launch-reference-main").innerText();
rep.check("review shows supply policy and listing", /Fixed \(issuer locked\)/.test(body) && /50,000 at 0\.02 XLM/.test(body));
rep.check("no fake liquidity venue / LP lock / valuation text", !/Soroswap|LP lock|Implied valuation|Not estimated|Liquidity lock/i.test(await page.locator("body").innerText()));
await page.getByRole("button", { name: "Launch asset" }).click();

const sheet = page.getByRole("dialog", { name: "Approve transaction" });
await sheet.waitFor();
const sheetText = await sheet.innerText();
rep.check("sheet shows issuer creation", /Create account/.test(sheetText));
rep.check("sheet shows issuer controls / home domain", /Home domain\s*nexo\.example/.test(sheetText));
rep.check("sheet shows 4 vesting tranches", (sheetText.match(/Lock funds in a claimable balance/g) ?? []).length === 4);
rep.check("sheet shows DEX offer", /Place sell offer/.test(sheetText) && /0\.02 XLM each/.test(sheetText));
rep.check("sheet shows permanent issuer lock", /Lock issuer \(permanent fixed supply\)/.test(sheetText));
await page.waitForTimeout(700);
await sheet.getByRole("button", { name: /Approve/ }).click();
await page.getByText("NEXO is live").waitFor();

const tx = submissions[0];
const verify = pub => tx.signatures.some(sg => Keypair.fromPublicKey(pub).verify(tx.hash(), Buffer.from(sg.signature.value ?? sg.signature())));
const issuer = tx.operations[0].destination;
rep.check("signed by wallet and new issuer", tx.signatures.length === 2 && verify(address) && verify(issuer));
rep.check("op sequence", tx.operations.map(o => o.type).join(",") === "createAccount,setOptions,changeTrust,payment,createClaimableBalance,createClaimableBalance,createClaimableBalance,createClaimableBalance,manageSellOffer,setOptions");
rep.check("minted full supply to wallet", tx.operations[3].amount === "1000000.0000000" && tx.operations[3].destination === address && tx.operations[3].source === issuer);
rep.check("vesting goes to beneficiary with time locks", tx.operations.slice(4, 8).every(o => o.claimants.length === 1 && o.claimants[0].destination === team && o.claimants[0].predicate.type === "claimPredicateNot"));
rep.check("issuer locked last", tx.operations[9].masterWeight === 0 && tx.operations[9].source === issuer);
rep.check("no issuer secret shown for fixed supply", !(await page.getByText("Issuer secret key").isVisible()));
rep.check("stellar.toml offered for home domain", /fixed_number=true/.test(await page.locator(".nx-wallet-dialog").innerText()));
await page.getByRole("button", { name: "Done" }).click();
await page.getByRole("tab", { name: "My launches" }).click();
await page.getByText("NEXO · Nexo Coin").waitFor();
rep.check("My launches lists the asset", true);

rep.print();
await browser.close();
