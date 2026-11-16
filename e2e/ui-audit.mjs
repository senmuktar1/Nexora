// Full UI audit: every route × guest/wallet × dark/light × desktop/mobile.
// All /api responses are replaced with poisoned errors to prove raw backend
// text never reaches the screen.
import { BASE, createWallet, loadPlaywright, reporter } from "./lib.mjs";
const { chromium, devices } = loadPlaywright();
const rep = reporter();
const SHOTS = process.env.E2E_SHOTS || "";

const ADDR = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ROUTES = ["/", "/explore", `/explore/token/USDC-${ADDR}`, "/assets", "/swap", `/swap/token/USDC-${ADDR}`, "/lend", "/earn",
  "/vouchers", "/redeem", `/pay/${ADDR}`, `/receipt/${"a".repeat(64)}`, "/launch", "/profile", `/creator/${ADDR}`,
  "/rwa", "/rwa/apply", "/rwa/RWA-2026-ABCDEF", "/rwa/applications/RWA-2026-ABCDEF", "/account", "/account/verify?token=x",
  "/docs", "/help", "/privacy", "/risk-disclosure", "/terms", "/wallet-security", "/restricted-regions", "/does-not-exist"];
const POISON = "POISON_7f3a relation \"users\" does not exist at Object.<anonymous> (/var/task/route.js:12:5) SUPABASE_SECRET_KEY=sb_secret_abc SAMPLESECRET";
const BANNED = /reader mode|testnet|in development|not integrated|not connected|\bpreview\b|coming soon|not available yet|stack trace|TypeError|ReferenceError|ECONN|fetch failed|HTTP \d{3}|Horizon returned|_API_KEY|SUPABASE|POISON_7f3a|sb_secret|\bundefined\b|\bNaN\b|\[object Object\]|\bTODO\b|lorem ipsum|placeholder|dummy|mock data|\bnull\b/i;

const browser = await chromium.launch();
async function audit(label, contextOpts, withWallet, theme) {
  const ctx = await browser.newContext(contextOpts);
  const page = await ctx.newPage();
  const cspErrors = [];
  page.on("console", m => { if (m.type() === "error" && /Content Security Policy|Refused to/.test(m.text())) cspErrors.push(m.text()); });
  page.on("pageerror", e => cspErrors.push("pageerror: " + e.message));
  await page.route("**/api/**", r => r.fulfill({ status: 502, json: { error: POISON, message: POISON, detail: POISON, reason: POISON, upstreamMessage: POISON } }));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate(t => localStorage.setItem("nexora-theme", t), theme);
  if (withWallet) await createWallet(page);
  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const text = await page.locator("body").innerText();
    const bad = text.match(BANNED);
    rep.check(`${label} ${route} clean copy`, !bad, bad ? `"${text.slice(Math.max(0, bad.index - 50), bad.index + 60).replace(/\s+/g, " ")}"` : "");
    const notes = await page.locator(".nx-info-note, .nx-mainnet-warning, .nx-guest-banner, .nx-error-banner, [role=alert]").allInnerTexts();
    const dupes = notes.filter((n, i) => n.trim() && notes.indexOf(n) !== i);
    rep.check(`${label} ${route} no repeated notices`, dupes.length === 0, dupes[0]?.slice(0, 80));
    if (contextOpts.isMobile) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      rep.check(`${label} ${route} no horizontal overflow`, overflow <= 1, `${overflow}px`);
    }
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label.replace(/\W+/g, "_")}${route.replace(/\W+/g, "_").slice(0, 40) || "_root"}.png` });
  }
  rep.check(`${label} no CSP violations or page errors`, cspErrors.length === 0, cspErrors[0]?.slice(0, 160));
  await ctx.close();
}

await audit("desktop-dark-guest", { viewport: { width: 1280, height: 900 } }, false, "dark");
await audit("desktop-light-wallet", { viewport: { width: 1280, height: 900 } }, true, "light");
await audit("mobile-dark-wallet", { ...devices["iPhone 13"] }, true, "dark");
await audit("mobile-light-guest", { ...devices["iPhone 13"] }, false, "light");
rep.print();
await browser.close();
