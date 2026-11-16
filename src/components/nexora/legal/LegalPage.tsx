/**
 * Legal and safety documents. DRAFTS for review by qualified counsel before public launch.
 * They describe how the software works; they assert no licences, approvals or regulatory
 * status, and make no assumptions about jurisdictions (owner-configured only).
 */

export type LegalKind = "privacy" | "risk" | "terms" | "wallet" | "regions";
export type LegalProps = {
  operator: string | null;
  contact: string | null;
  governingLaw: string | null;
  effectiveDate: string | null;
  approved: boolean;
  restrictedCountries: string[];
  blocked?: boolean;
};

type Section = [string, string[]];

function countryName(code: string) {
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code; } catch { return code; }
}

function sections(kind: LegalKind, c: LegalProps): { eyebrow: string; title: string; body: Section[] } {
  const who = c.operator ?? "the operator of this website";
  const Who = c.operator ?? "The operator of this website";
  const contact = c.contact ? [`Questions about this document: ${c.contact}.`] : [];
  switch (kind) {
    case "privacy": return { eyebrow: "PRIVACY POLICY", title: "Privacy Policy", body: [
      ["Who we are", [`NEXORA is operated by ${who}.`, ...contact]],
      ["Your wallet", [
        "Your secret key is generated or imported in your browser, encrypted with your password (PBKDF2-SHA256 and AES-256-GCM) and stored only in this browser’s IndexedDB.",
        "Your secret key and password are never sent to NEXORA servers or any third party.",
        "Voucher links keep the claim secret in the part of the link after “#”, which browsers do not send to servers."
      ]],
      ["What our servers process", [
        "NEXORA has no user accounts or database. To show market data and process transactions, our servers relay requests to Stellar Horizon, a Soroban RPC provider, StellarExpert and DeFindex. These requests contain public information such as your Stellar address, asset identifiers and signed transactions.",
        "Signed transactions become public and permanent once submitted to the Stellar network.",
        "When an error occurs, our servers log technical details with a request ID. Secret keys, tokens and URL query strings are redacted before logging.",
        "Our hosting provider processes standard request data such as IP addresses, and may use the approximate country of a request to apply regional restrictions."
      ]],
      ["On this device", [
        "NEXORA stores your theme, watchlist and recent searches in local storage, and your encrypted wallet and encrypted records (such as voucher links and launched-asset keys) in IndexedDB.",
        "NEXORA does not use analytics, advertising trackers or cookies."
      ]],
      ["Your choices", [
        "Profile → Delete account erases the encrypted wallet, encrypted records and NEXORA data stored in this browser. Transactions already on the Stellar network cannot be erased."
      ]]
    ] };
    case "risk": return { eyebrow: "RISK DISCLOSURE", title: "Risks of using NEXORA", body: [
      ["Self-custody", [
        "You alone control your wallet. If you lose your secret key and forget your password, nobody — including the operator — can recover your funds.",
        "Anyone who obtains your secret key can take your funds."
      ]],
      ["Transactions", [
        "Stellar transactions are final once confirmed and cannot be reversed.",
        "Swap prices can move between quote and execution; your minimum received protects against movement beyond your slippage setting.",
        "Network fees and account reserves (XLM held by the network for trustlines, offers and other entries) apply."
      ]],
      ["Assets and issuers", [
        "Anyone can issue a Stellar asset with any code. Always check the issuer, not just the ticker.",
        "Issuers can configure controls that let them freeze or claw back holdings. NEXORA shows these settings where available.",
        "Information an issuer publishes about itself, including claims about real-world backing, is not independently verified."
      ]],
      ["Smart contracts, lending and vaults", [
        "Lending pools, vaults and tokens are smart contracts that may contain bugs or be affected by oracle or strategy failures.",
        "Borrowing can lead to liquidation if your collateral falls in value. Rates shown are variable estimates, not guarantees.",
        "Vault share values can fall; withdrawals return the vault’s assets at the then-current share value."
      ]],
      ["General", [
        "NEXORA does not provide financial, legal or tax advice.",
        "Some assets and services may not be available or lawful for you depending on where you live. You are responsible for complying with the rules that apply to you."
      ]]
    ] };
    case "terms": return { eyebrow: "TERMS OF SERVICE", title: "Terms of Service", body: [
      ["Agreement", [`These terms govern your use of the NEXORA software interface (“NEXORA”) operated by ${who}. By using NEXORA you agree to them. If you do not agree, do not use NEXORA.`]],
      ["What NEXORA is", [
        "NEXORA is non-custodial software that helps you create and sign Stellar transactions in your browser and relay them to the Stellar network. " + Who + " never holds your keys or funds and cannot move, freeze, reverse or recover them.",
        "Third-party networks and protocols (including Stellar, Soroban smart contracts, Blend and DeFindex) are not operated by " + who + ". Their availability, behaviour and outcomes are outside our control."
      ]],
      ["Eligibility", [
        "You must be of legal age to enter into this agreement where you live, and you must not use NEXORA where doing so is prohibited by law or from a region that NEXORA restricts.",
        "You must not use NEXORA if you are subject to sanctions or acting on behalf of a sanctioned person."
      ]],
      ["Your responsibilities", [
        "You are responsible for keeping your secret key and password safe, for reviewing every transaction before approving it, and for any taxes and legal obligations arising from your use.",
        "You must not use NEXORA for unlawful activity, to infringe others’ rights, to interfere with the service, or to issue assets that impersonate others or mislead users."
      ]],
      ["Fees", ["NEXORA does not charge fees. Stellar network fees, account reserves and any protocol fees apply and are shown before you approve a transaction where available."]],
      ["No advice; information", ["Market data, rates, issuer information and other content are provided for information only, may be incomplete or delayed, and are not financial, investment, legal or tax advice."]],
      ["Disclaimers", ["NEXORA is provided “as is” and “as available”, without warranties of any kind, to the fullest extent permitted by law."]],
      ["Limitation of liability", ["To the fullest extent permitted by law, " + who + " is not liable for indirect, incidental or consequential losses, or for losses arising from your keys, your transactions, network conditions or third-party protocols."]],
      ["Changes and termination", ["These terms may be updated; continued use after an update means you accept the new terms. Access may be restricted or discontinued at any time."]],
      ...(c.governingLaw ? [["Governing law", [`These terms are governed by ${c.governingLaw}.`]] as Section] : []),
      ...(c.contact ? [["Contact", contact]] as Section[] : [])
    ] };
    case "wallet": return { eyebrow: "WALLET SECURITY", title: "Wallet security and recovery", body: [
      ["How your wallet works", [
        "Your wallet is a Stellar secret key created or imported in this browser. It is encrypted with your password and stored only on this device.",
        "Signing happens in your browser after you approve the exact transaction shown in the approval sheet."
      ]],
      ["Back up your secret key", [
        "When you create a wallet, write the secret key down and store it offline. It is the only way to recover your wallet on another device or after deleting it.",
        "Never share your secret key or enter it on another website. NEXORA will never ask for it outside the import screen."
      ]],
      ["If you forget your password", ["Your password cannot be reset. Use Profile → Delete account, then import your wallet again with your secret key and choose a new password."]],
      ["Deleting your account", [
        "Deleting your NEXORA account erases the encrypted wallet and NEXORA data from this browser only.",
        "It does not delete your Stellar account, its assets or its transaction history, which remain on the Stellar network. You can access them again by importing your secret key."
      ]],
      ["Different devices and domains", ["Wallet data is stored per browser and per website address. A wallet created here is not available on another device or domain until you import it there."]]
    ] };
    case "regions": {
      const list = c.restrictedCountries;
      return { eyebrow: "REGIONAL AVAILABILITY", title: c.blocked ? "Not available in your region" : "Regional availability", body: [
        ...(c.blocked ? [["Access restricted", ["NEXORA isn’t available in your region. Legal information on this site remains accessible."]] as Section] : []),
        ["Restricted regions", list.length
          ? [`NEXORA is not available in: ${list.map(countryName).join(", ")}.`]
          : ["NEXORA does not currently restrict access by region."]],
        ["Your responsibility", ["Regardless of this list, you must only use NEXORA where doing so is lawful for you."]],
        ...(c.contact ? [["Contact", contact]] as Section[] : [])
      ] };
    }
  }
}

export default function LegalPage({ kind, config }: { kind: LegalKind; config: LegalProps }) {
  const doc = sections(kind, config);
  const isLegal = kind === "terms" || kind === "privacy" || kind === "risk";
  return <article className="nx-legal">
    <div className="nx-eyebrow">{doc.eyebrow}</div>
    <h1>{doc.title}</h1>
    {isLegal && !config.approved && <p className="nx-legal-draft">Draft pending legal review.</p>}
    {config.effectiveDate && isLegal && <p className="nx-legal-date">Effective {new Date(config.effectiveDate).toLocaleDateString(undefined, { dateStyle: "long" })}</p>}
    {doc.body.map(([title, items]) => <section key={title}>
      <h2>{title}</h2>
      <ul>{items.map(item => <li key={item}>{item}</li>)}</ul>
    </section>)}
  </article>;
}
