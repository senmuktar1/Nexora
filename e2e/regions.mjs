// Regional restriction acceptance. Requires a server started with
//   RESTRICTED_COUNTRIES=ZZ GEO_COUNTRY_HEADER=x-test-country
// (ZZ is a user-assigned ISO code, so no real jurisdiction is implied).
import { BASE, loadPlaywright, reporter } from "./lib.mjs";
const { chromium } = loadPlaywright();
const rep = reporter();
const browser = await chromium.launch();

const blocked = await browser.newContext({ extraHTTPHeaders: { "x-test-country": "ZZ" } });
const page = await blocked.newPage();
await page.goto(BASE + "/swap", { waitUntil: "networkidle" });
rep.check("restricted visitor sees branded regional page instead of the app", /Not available in your region/.test(await page.locator("body").innerText()) && (await page.locator(".nx-header").count()) === 1);
const api = await page.request.post(BASE + "/api/stellar/submit", { data: { xdr: "AAAA" } });
rep.check("transaction APIs return 451 for restricted visitors", api.status() === 451);
await page.goto(BASE + "/terms", { waitUntil: "networkidle" });
rep.check("legal pages stay reachable", /Terms of Service/.test(await page.locator("h1").innerText()));
rep.check("health stays reachable", (await page.request.get(BASE + "/api/health")).status() === 200);

const allowed = await browser.newContext({ extraHTTPHeaders: { "x-test-country": "FR" } });
const p2 = await allowed.newPage();
await p2.goto(BASE + "/swap", { waitUntil: "networkidle" });
rep.check("other visitors use the app normally", !/Not available in your region/.test(await p2.locator("body").innerText()) && (await p2.getByRole("heading", { name: "Swap" }).count()) > 0);
await p2.goto(BASE + "/restricted-regions", { waitUntil: "networkidle" });
rep.check("regional page lists only owner-configured codes", /not available in: ZZ|not available in: Unknown Region/i.test(await p2.locator("body").innerText()));
rep.print();
await browser.close();
