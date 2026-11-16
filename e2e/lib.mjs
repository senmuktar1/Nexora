// Shared helpers for NEXORA browser acceptance tests.
// Requires Playwright (not a project dependency, to keep production installs lean):
//   npm i --no-save playwright && npx playwright install chromium
// Then run against a production server: npm run build && npm start, and `npm run test:e2e`.
// E2E_BASE_URL overrides the target (default http://localhost:3100).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export function loadPlaywright() {
  try { return require("playwright"); } catch {
    console.error("Playwright is not installed. Run: npm i --no-save playwright && npx playwright install chromium");
    process.exit(2);
  }
}
export const BASE = process.env.E2E_BASE_URL || "http://localhost:3100";
export function reporter() {
  const results = [];
  return {
    check(name, ok, extra = "") { results.push({ name, ok: Boolean(ok), extra }); },
    print() {
      for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.extra ? " — " + r.extra : ""}`);
      const failed = results.filter(r => !r.ok).length;
      console.log(`\n${results.length - failed}/${results.length} passed`);
      if (failed) process.exitCode = 1;
    }
  };
}
export async function createWallet(page, password = "correct horse battery") {
  await page.getByRole("button", { name: /Create or import wallet|^Wallet$/ }).first().click();
  await page.getByRole("button", { name: /Create a new wallet/ }).click();
  const address = (await page.locator(".nx-wallet-code").first().textContent()).trim();
  await page.getByRole("button", { name: /Reveal/ }).click();
  const secret = (await page.getByLabel("Secret key", { exact: true }).textContent()).trim();
  await page.getByLabel(/I have saved my secret key/).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create wallet", exact: true }).click();
  await page.waitForSelector(".nx-wallet-connected");
  return { address, secret };
}
