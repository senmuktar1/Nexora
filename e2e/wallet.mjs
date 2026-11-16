import { BASE as base, loadPlaywright, reporter } from "./lib.mjs";
const { chromium } = loadPlaywright();
const rep = reporter();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
const check = rep.check;

await page.goto(base + "/", { waitUntil: "networkidle" });
const body0 = await page.textContent("body");
check("no reader-mode/testnet/in-development text on Explore", !/reader mode|testnet|in development|not integrated/i.test(body0));
await page.getByRole("button", { name: /Create or import wallet/ }).click();
await page.getByRole("button", { name: /Create a new wallet/ }).click();
const addr = (await page.locator(".nx-wallet-code").first().textContent()).trim();
check("generated G-address", /^G[A-Z2-7]{55}$/.test(addr), addr.slice(0, 8));
check("continue disabled before backup confirmation", await page.getByRole("button", { name: "Continue" }).isDisabled());
await page.getByRole("button", { name: /Reveal/ }).click();
const secret = (await page.getByLabel("Secret key", { exact: true }).textContent()).trim();
check("secret revealed is S-key", /^S[A-Z2-7]{55}$/.test(secret));
await page.getByLabel(/I have saved my secret key/).check();
await page.getByRole("button", { name: "Continue" }).click();
await page.getByLabel("Password", { exact: true }).fill("short");
await page.getByLabel("Confirm password").fill("short");
await page.getByRole("button", { name: "Create wallet" }).click();
check("weak password rejected", await page.getByText(/at least 10 characters/).isVisible());
await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
await page.getByLabel("Confirm password").fill("correct horse battery");
await page.getByRole("button", { name: "Create wallet" }).click();
await page.waitForSelector(".nx-wallet-connected");

const storage = await page.evaluate(async () => {
  const ls = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
  const vault = await new Promise(res => { const r = indexedDB.open("nexora-wallet"); r.onsuccess = () => { const tx = r.result.transaction("vault"); const g = tx.objectStore("vault").get("primary"); g.onsuccess = () => res(g.result); }; });
  return { ls, vault };
});
check("vault stored in IndexedDB with matching address", storage.vault?.publicKey === addr);
check("secret not in vault record", !JSON.stringify(storage.vault).includes(secret));
check("secret not in local/session storage", !storage.ls.includes(secret));
check("vault params", storage.vault?.kdf?.iterations === 600000 && storage.vault?.cipher?.name === "AES-GCM");

// lock and unlock
await page.locator(".nx-wallet-connected").click();
await page.getByRole("button", { name: /Lock wallet/ }).click();
await page.locator(".nx-wallet-connected").click();
await page.getByRole("button", { name: /Unlock wallet/ }).click();
await page.getByLabel("Password").fill("wrong password!!");
await page.getByRole("button", { name: /Unlock/ }).last().click();
await page.getByText("Incorrect password.").waitFor();
check("wrong password rejected", true);
await page.getByLabel("Password").fill("correct horse battery");
await page.getByRole("button", { name: /Unlock/ }).last().click();
await page.waitForSelector(".nx-wallet-dialog", { state: "detached" });
check("unlock succeeded", true);

// pages: no forbidden text
for (const path of ["/swap", "/lend", "/vouchers", "/launch", "/profile", "/assets"]) {
  await page.goto(base + path, { waitUntil: "networkidle" });
  const t = await page.textContent("body");
  const bad = t.match(/reader mode|testnet|in development|not integrated|stack|TypeError|ECONN|fetch failed|HTTP \d{3}|Horizon returned|STELLAR_EXPERT_API_KEY|DEFINDEX_API_KEY/i);
  check(`clean copy on ${path}`, !bad, bad?.[0] ?? "");
  }

// delete account
await page.goto(base + "/profile", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /^Delete account$/ }).click();
check("delete button disabled until typed", await page.getByRole("button", { name: "Delete permanently" }).isDisabled());
await page.locator("#nx-delete-confirm").fill("DELETE");
await page.getByRole("button", { name: "Delete permanently" }).click();
await page.waitForURL(base + "/");
await page.getByRole("dialog", { name: "Wallet" }).waitFor();
const after = await page.evaluate(async () => ({
  dbs: (await indexedDB.databases()).map(d => d.name),
  ls: Object.keys(localStorage).filter(k => k.startsWith("nexora"))
}));
check("wallet database removed", !after.dbs.includes("nexora-wallet"), JSON.stringify(after.dbs));
check("nexora local storage cleared", after.ls.length === 0, JSON.stringify(after.ls));
check("onboarding shown after delete", await page.getByRole("button", { name: /Create a new wallet/ }).isVisible());

// restore via import
await page.getByRole("button", { name: /Import a wallet/ }).click();
await page.locator("#nx-import-secret").fill(secret);
await page.getByLabel("Password", { exact: true }).fill("another strong pw");
await page.getByLabel("Confirm password").fill("another strong pw");
await page.getByRole("button", { name: "Import wallet", exact: true }).click();
await page.waitForSelector(".nx-wallet-connected");
const restored = await page.locator(".nx-wallet-address").textContent();
check("import restores same address", restored.startsWith(addr.slice(0, 6)) && restored.endsWith(addr.slice(-5)));

const csp = consoleErrors.filter(e => /Content Security Policy|Refused to/i.test(e));
check("no CSP violations", csp.length === 0, csp.slice(0, 2).join(" | "));
rep.print();
console.log("console errors (non-CSP):", consoleErrors.filter(e => !csp.includes(e)).slice(0, 5));
await browser.close();
