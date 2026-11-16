// Voucher lifecycle acceptance: create → share link → redeem (second wallet) → duplicate
// redemption refused → refund of an expired voucher. Real UI, real wallets, real guard and
// signing; Horizon is simulated statefully from the transactions the app actually submits.
// Nothing leaves the machine.
import { createRequire } from "node:module";
import { BASE, createWallet, loadPlaywright, reporter } from "./lib.mjs";
const require = createRequire(import.meta.url);
const { Keypair, Networks, TransactionBuilder, Claimant, Asset, Operation, Account } = require("@stellar/stellar-sdk");
const { chromium } = loadPlaywright();
const rep = reporter();

const chain = { balances: new Map(), accounts: new Map(), submissions: [] };
const nativeLine = xlm => ({ asset_type: "native", asset_code: "XLM", balance: xlm, selling_liabilities: "0", buying_liabilities: "0" });
function predicateJson(p) {
  if (p.type === "claimPredicateUnconditional") return { unconditional: true };
  if (p.type === "claimPredicateBeforeAbsoluteTime") return { abs_before_epoch: String(p.absBefore) };
  if (p.type === "claimPredicateNot") return { not: predicateJson(p.notPredicate) };
  if (p.type === "claimPredicateAnd") return { and: p.andPredicates.map(predicateJson) };
  return {};
}

async function mockStellar(page) {
  await page.route("**/api/stellar/**", async route => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p === "/api/stellar/account") {
      const a = chain.accounts.get(url.searchParams.get("address"));
      if (!a) return route.fulfill({ status: 404, json: { error: "x" } });
      return route.fulfill({ json: { account: { account_id: a.id, sequence: a.seq, subentry_count: 0, num_sponsoring: 0, num_sponsored: 0 }, balances: [nativeLine(a.xlm)], transactions: [], offers: [] } });
    }
    if (p === "/api/stellar/fee") return route.fulfill({ json: { perOperation: 100 } });
    if (p === "/api/stellar/claimable-balances") {
      const id = url.searchParams.get("id");
      if (id) { const b = chain.balances.get(id); return route.fulfill({ json: b ? { status: "open", balance: b } : { status: "not_found" } }); }
      const c = url.searchParams.get("claimant");
      return route.fulfill({ json: { balances: [...chain.balances.values()].filter(b => b.raw.some(r => r.destination === c)) } });
    }
    if (p === "/api/stellar/submit") {
      const { xdr } = route.request().postDataJSON();
      const tx = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC);
      const hash = Buffer.from(tx.hash()).toString("hex");
      chain.submissions.push(tx);
      // Apply effects
      for (const [i, op] of tx.operations.entries()) {
        if (op.type === "createClaimableBalance") {
          const id = tx.getClaimableBalanceId(i);
          const claimants = op.claimants.map(c => ({ destination: c.destination, predicate: predicateJson(c.predicate) }));
          chain.balances.set(id, { id, asset: "native", amount: op.amount, sponsor: tx.source, createdAt: new Date().toISOString(), raw: claimants,
            claimants: claimants.map(c => ({ destination: c.destination, predicate: normalise(c.predicate) })) });
        }
        if (op.type === "claimClaimableBalance") {
          if (!chain.balances.has(op.balanceId)) return route.fulfill({ json: { status: "failed", hash, code: "op_does_not_exist" } });
          chain.balances.delete(op.balanceId);
        }
      }
      const acct = chain.accounts.get(tx.source); if (acct) acct.seq = String(BigInt(acct.seq) + 1n);
      return route.fulfill({ json: { status: "confirmed", hash, ledger: 1 } });
    }
    return route.fulfill({ status: 502, json: { error: "Temporarily unavailable." } });
  });
}
function normalise(p) {
  if (p.unconditional) return { type: "unconditional" };
  if (p.abs_before_epoch) return { type: "beforeAbsolute", epoch: Number(p.abs_before_epoch) };
  if (p.not) return { type: "not", predicate: normalise(p.not) };
  if (p.and) return { type: "and", predicates: p.and.map(normalise) };
  return { type: "beforeAbsolute", epoch: 0 };
}
async function approve(page) {
  const unlockDialog = page.getByRole("dialog", { name: "Wallet" });
  const sheet = page.getByRole("dialog", { name: "Approve transaction" });
  await Promise.race([sheet.waitFor().catch(() => undefined), unlockDialog.waitFor().catch(() => undefined)]);
  if (await unlockDialog.isVisible()) {
    await unlockDialog.getByLabel("Password").fill("correct horse battery");
    await unlockDialog.getByRole("button", { name: /Unlock/ }).click();
    unlockedOnDemand = true;
  }
  await sheet.waitFor({ timeout: 10000 }).catch(async () => {
    console.log("DIALOGS:", await page.locator("[role=dialog]").allInnerTexts());
    throw new Error("approval sheet did not appear");
  });
  await page.waitForTimeout(700);
  const text = await sheet.innerText();
  await sheet.getByRole("button", { name: /Approve/ }).click();
  return text;
}

let unlockedOnDemand = false;
const browser = await chromium.launch();

// ---- Creator ----
const creatorCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await creatorCtx.grantPermissions(["clipboard-read", "clipboard-write"]);
const creator = await creatorCtx.newPage();
await mockStellar(creator);
await creator.goto(BASE + "/vouchers", { waitUntil: "networkidle" });
const { address: creatorAddr } = await createWallet(creator);
chain.accounts.set(creatorAddr, { id: creatorAddr, seq: "1000", xlm: "100.0000000" });

await creator.getByRole("button", { name: /Stellar Lumens|^XLM/ }).first().click();
await creator.getByRole("button", { name: /Continue to amount/ }).click();
await creator.locator(".nx-voucher-amount-input input").first().fill("6");
// 5 → 2 cards
for (let i = 0; i < 3; i++) await creator.getByRole("button", { name: "Remove one card" }).click();
await creator.locator(".nx-voucher-step-actions .nx-primary-button").click();
await creator.getByRole("button", { name: /Review voucher batch/ }).click();
const cardsText = await creator.locator(".nx-voucher-review-list").innerText();
const cardCount = Number(cardsText.match(/Number of vouchers\s*(\d+)/)?.[1]);
await creator.getByRole("button", { name: "Create vouchers" }).click();
const sheetText = await approve(creator);
rep.check("approval sheet lists one claimable balance per card", (sheetText.match(/Lock funds in a claimable balance/g) ?? []).length === cardCount, `${cardCount} cards`);
rep.check("approval sheet shows expiry condition for the voucher key", /Before /.test(sheetText) && /You · Not \(Before/.test(sheetText));
await creator.getByText("Vouchers ready").waitFor();
const createTx = chain.submissions.at(-1);
rep.check("create tx signed by creator only", createTx.signatures.length === 1 && Keypair.fromPublicKey(creatorAddr).verify(createTx.hash(), Buffer.from(createTx.signatures[0].signature.value ?? createTx.signatures[0].signature())));
rep.check("balances recorded on (simulated) chain", chain.balances.size === cardCount);
await creator.getByRole("button", { name: "Copy link" }).first().click();
const link = await creator.evaluate(() => navigator.clipboard.readText());
rep.check("share link carries secret only in the fragment", /\/redeem#k=S[A-Z2-7]{55}&b=[0-9a-f]{72}/.test(link) && !link.split("#")[0].includes("k="));
await creator.getByRole("button", { name: "QR" }).first().click();
rep.check("QR code rendered locally", await creator.locator("img.nx-voucher-qr").first().isVisible());
await creator.getByRole("button", { name: "Done" }).click();

// My cards shows them, with links (wallet unlocked)
await creator.getByRole("tab", { name: /My Cards/ }).click();
await creator.locator(".nx-voucher-mine-row").first().waitFor();
rep.check("My Cards lists created vouchers as unclaimed", (await creator.locator(".nx-voucher-mine-row", { hasText: "Unclaimed" }).count()) === cardCount);

// ---- Recipient ----
const recipientCtx = await browser.newContext({ viewport: { width: 420, height: 900 } });
const recipient = await recipientCtx.newPage();
await mockStellar(recipient);
const path = link.replace(/^https?:\/\/[^/]+/, "");
await recipient.goto(BASE + "/", { waitUntil: "networkidle" });
const { address: recipientAddr } = await createWallet(recipient);
chain.accounts.set(recipientAddr, { id: recipientAddr, seq: "77", xlm: "20.0000000" });
const submitted = [];
recipient.on("request", r => { if (r.url().includes("/api/")) submitted.push(r.url()); });
await recipient.goto(BASE + path, { waitUntil: "networkidle" });
await recipient.getByRole("button", { name: "Redeem to my wallet" }).waitFor();
rep.check("voucher secret never sent to the server", !submitted.some(u => u.includes("k=S")));
await recipient.getByRole("button", { name: "Redeem to my wallet" }).click();
const redeemSheet = await approve(recipient);
rep.check("redemption sheet shows temp-account ops from the voucher key", /Create account/.test(redeemSheet) && /Claim balance/.test(redeemSheet) && /From account/.test(redeemSheet));
await recipient.getByText("Redeemed to your wallet.").waitFor();
rep.check("wallet locked after page reload; unlock required before signing", unlockedOnDemand);
const redeemTx = chain.submissions.at(-1);
const sigOk = (pub) => redeemTx.signatures.some(sg => Keypair.fromPublicKey(pub).verify(redeemTx.hash(), Buffer.from(sg.signature.value ?? sg.signature())));
const voucherKey = redeemTx.operations[1].source;
rep.check("redeem tx carries valid recipient + voucher-key signatures", redeemTx.signatures.length === 2 && redeemTx.source === recipientAddr && sigOk(recipientAddr) && sigOk(voucherKey));
rep.check("redeem ops: createAccount → claim → merge", redeemTx.operations.map(o => o.type).join(",") === "createAccount,claimClaimableBalance,accountMerge");
rep.check("fragment cleared from address bar after redeem", !(await recipient.evaluate(() => location.hash)));

// Duplicate redemption
await recipient.goto(BASE + path, { waitUntil: "networkidle" });
await recipient.getByText("This voucher has already been claimed or refunded.").waitFor();
rep.check("duplicate redemption refused", true);

// ---- Refund an expired voucher ----
const pastExpiry = Math.floor(Date.now() / 1000) - 60;
const e = Keypair.random();
const stale = new TransactionBuilder(new Account(creatorAddr, "1"), { fee: "100", networkPassphrase: Networks.PUBLIC, timebounds: { minTime: 0, maxTime: 0 } })
  .addOperation(Operation.createClaimableBalance({ asset: Asset.native(), amount: "4", claimants: [
    new Claimant(e.publicKey(), Claimant.predicateBeforeAbsoluteTime(String(pastExpiry))),
    new Claimant(creatorAddr, Claimant.predicateNot(Claimant.predicateBeforeAbsoluteTime(String(pastExpiry)))) ] })).build();
const staleId = stale.getClaimableBalanceId(0);
const staleClaimants = stale.operations[0].claimants.map(c => ({ destination: c.destination, predicate: predicateJson(c.predicate) }));
chain.balances.set(staleId, { id: staleId, asset: "native", amount: "4.0000000", sponsor: creatorAddr, createdAt: new Date().toISOString(), raw: staleClaimants, claimants: staleClaimants.map(c => ({ destination: c.destination, predicate: normalise(c.predicate) })) });
await creator.reload({ waitUntil: "networkidle" });
await creator.getByRole("tab", { name: /My Cards/ }).click();
await creator.getByRole("button", { name: /Refund 1 expired/ }).click();
const refundSheet = await approve(creator);
rep.check("refund sheet claims only the expired balance", (refundSheet.match(/Claim balance/g) ?? []).length === 1);
await creator.getByText("Refund confirmed.").waitFor();
rep.check("expired voucher refunded", !chain.balances.has(staleId));

rep.print();
await browser.close();
