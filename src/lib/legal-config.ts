import "server-only";
import { parseCountryList } from "./region";

export type LegalConfig = {
  operator: string | null;
  contact: string | null;
  governingLaw: string | null;
  effectiveDate: string | null;
  approved: boolean;
  restrictedCountries: string[];
};

/** Owner-supplied legal settings (all optional; nothing is assumed when unset). */
export function legalConfig(env: NodeJS.ProcessEnv = process.env): LegalConfig {
  const text = (v: string | undefined, max: number) => { const t = v?.trim(); return t ? t.slice(0, max) : null; };
  const email = text(env.LEGAL_CONTACT_EMAIL, 200);
  const date = text(env.LEGAL_EFFECTIVE_DATE, 40);
  return {
    operator: text(env.LEGAL_OPERATOR_NAME, 200),
    contact: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    governingLaw: text(env.LEGAL_GOVERNING_LAW, 200),
    effectiveDate: date && !Number.isNaN(Date.parse(date)) ? date : null,
    approved: env.LEGAL_DOCS_APPROVED === "true",
    restrictedCountries: [...parseCountryList(env.RESTRICTED_COUNTRIES)].sort()
  };
}
