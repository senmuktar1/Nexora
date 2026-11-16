// RWA evidence acceptance: statuses are shown only as supported by evidence. Mocked responses.
import { BASE, loadPlaywright, reporter } from "./lib.mjs";
const { chromium } = loadPlaywright();
const rep = reporter();
const A = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7", B = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", C = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ev = (asset, link, published, extra = {}) => ({ status: "ok", asset, retrievedAt: new Date().toISOString(), domainLink: { status: link }, published,
  onChain: { exists: true, authRequired: true, authRevocable: true, authImmutable: false, clawbackEnabled: false, issuerLocked: false, holders: 120, circulating: "5000000.0000000", homeDomain: link === "no_domain" ? null : "fund.example", ...extra } });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.route("**/api/stellar/**", r => {
  const u = new URL(r.request().url());
  if (u.pathname === "/api/stellar/assets") return r.fulfill({ json: { assets: [{ asset_code: "TBILL", asset_issuer: A, num_accounts: "120" }, { asset_code: "TBILL", asset_issuer: B, num_accounts: "3" }, { asset_code: "TBILL", asset_issuer: C, num_accounts: "1" }] } });
  if (u.pathname === "/api/stellar/issuer") {
    const issuer = u.searchParams.get("asset").split(":")[1];
    if (issuer === A) return r.fulfill({ json: ev(`TBILL:${A}`, "linked", { orgName: "Fund Co", orgUrl: "https://fund.example", name: "T-Bill Fund", description: "Tokenized fund.", isAnchored: true, anchorAssetType: "bond", anchorAsset: "US Treasury bills", attestation: "https://fund.example/a.pdf", redemption: "Via transfer agent.", regulated: true, approvalServer: "https://fund.example/sep8", approvalCriteria: "KYC required.", conditions: "Not for US persons.", status: "live", fixedNumber: false }) });
    if (issuer === B) return r.fulfill({ json: ev(`TBILL:${B}`, "not_listed", null) });
    return r.fulfill({ json: ev(`TBILL:${C}`, "no_domain", null, { authRequired: false, issuerLocked: true }) });
  }
  return r.fulfill({ status: 502, json: { error: "x" } });
});
await page.goto(BASE + "/assets", { waitUntil: "networkidle" });
await page.locator(".nx-directory-search input").fill("TBILL");
await page.getByRole("button", { name: "Check issuer" }).first().waitFor();
const rows = page.getByRole("button", { name: "Check issuer" });
const dialog = page.getByRole("dialog", { name: "Issuer evidence" });

await rows.nth(0).click(); await dialog.getByText("Holders").waitFor();
let t = await dialog.innerText();
rep.check("linked issuer: domain link shown", /fund\.example lists this asset/.test(t));
rep.check("linked issuer: claims labelled as issuer-published", /Published by the issuer · not independently verified/i.test(t));
rep.check("no 'verified issuer' / 'audited' claims", !/verified issuer|audited|guaranteed/i.test(t.replace(/not independently verified/i, "")));
rep.check("eligibility and restrictions shown", /Holder approval required\s*Yes/.test(t) && /Not for US persons/.test(t) && /requires the issuer’s approval/.test(t));
await dialog.getByRole("button", { name: "Close" }).click();

await rows.nth(1).click(); await dialog.getByText("Holders").waitFor();
t = await dialog.innerText();
rep.check("impostor: caution and no published claims", /does not list this asset/.test(t) && !/Published by the issuer/i.test(t));
await dialog.getByRole("button", { name: "Close" }).click();

await rows.nth(2).click(); await dialog.getByText("Holders").waitFor();
t = await dialog.innerText();
rep.check("no domain: stated plainly; locked supply shown", /No issuer domain is linked/.test(t) && /Supply can still grow\s*No \(issuer locked\)/.test(t));
rep.check("reference cards labelled as stellar.org references", (await page.getByText("stellar.org reference").count()) > 0);
rep.print();
await browser.close();
