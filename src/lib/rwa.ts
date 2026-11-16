/**
 * Real-world-asset (RWA) model shared by the browser and the server: categories,
 * statuses, fields and document kinds. The server re-validates everything.
 */

export const RWA_CATEGORIES = {
  real_estate: "Real estate",
  gold_commodities: "Gold & commodities",
  agriculture: "Agriculture",
  private_credit: "Private credit",
  government_securities: "Government securities",
  money_market_funds: "Money market funds",
  renewable_energy: "Renewable energy",
  other: "Other eligible asset"
} as const;
export type RwaCategory = keyof typeof RWA_CATEGORIES;

export const RWA_STATUSES = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  info_requested: "Additional information requested",
  approved: "Approved",
  rejected: "Rejected",
  suspended: "Suspended"
} as const;
export type RwaStatus = keyof typeof RWA_STATUSES;

/** Text fields of an application: [key, label, max length, required for submission, multiline]. */
export const RWA_TEXT_FIELDS = [
  ["asset_name", "Asset name", 120, true, false],
  ["description", "Description", 4000, true, true],
  ["country", "Country", 80, true, false],
  ["jurisdiction", "Jurisdiction (governing law / regulator)", 160, true, false],
  ["issuer_legal_name", "Legal issuer name", 200, true, false],
  ["issuer_registration", "Issuer registration (company number, register)", 200, true, false],
  ["custodian", "Custodian", 200, true, false],
  ["insurance", "Insurance (insurer, policy, coverage)", 1000, false, true],
  ["legal_structure", "Legal ownership structure", 2000, true, true],
  ["redemption_conditions", "Redemption conditions", 2000, true, true],
  ["investor_eligibility", "Investor eligibility", 2000, true, true],
  ["transfer_restrictions", "Transfer restrictions", 2000, true, true],
  ["additional_info", "Additional supporting information", 4000, false, true]
] as const;
export type RwaTextField = typeof RWA_TEXT_FIELDS[number][0];

export const RWA_DOCUMENT_KINDS = {
  ownership: "Proof of ownership",
  valuation: "Independent valuation report",
  offering: "Offering document",
  registration: "Issuer registration",
  insurance: "Insurance certificate",
  custody: "Custody confirmation",
  legal_opinion: "Legal opinion / regulatory clearance",
  inspection: "Inspection report",
  report: "Issuer report",
  other: "Additional evidence"
} as const;
export type RwaDocumentKind = keyof typeof RWA_DOCUMENT_KINDS;

/** Documents required before an application can be submitted. */
export const REQUIRED_DOCUMENTS: RwaDocumentKind[] = ["ownership", "valuation", "offering", "registration"];

export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
export const ALLOWED_DOCUMENT_TYPES = { "application/pdf": "PDF", "image/png": "PNG", "image/jpeg": "JPEG" } as const;

/** Review subjects for verification findings. */
export const FINDING_SUBJECTS = {
  issuer: "Issuer identity & authority",
  ownership: "Legal ownership",
  valuation: "Valuation",
  custody: "Custody",
  insurance: "Insurance",
  offering: "Offering documents",
  legal_structure: "Legal structure",
  legal_clearance: "Legal & regulatory clearance",
  other: "Other"
} as const;
export type FindingSubject = keyof typeof FINDING_SUBJECTS;

/** Subjects that need a "verified" finding before final tokenization authorization. */
export const VERIFICATION_REQUIRED: FindingSubject[] = ["issuer", "ownership", "valuation"];

export const EVIDENCE_STATUS = { declared: "Issuer declaration", verified: "Verified by NEXORA", not_verified: "Could not verify" } as const;
export type EvidenceStatus = keyof typeof EVIDENCE_STATUS;

export const TOKEN_CONFIG_STATUSES = {
  draft: "Draft",
  submitted: "Submitted for authorization",
  authorized: "Authorized for issuance",
  issued: "Issued on Stellar",
  revoked: "Authorization revoked"
} as const;
export type TokenConfigStatus = keyof typeof TOKEN_CONFIG_STATUSES;

export const TOKEN_TEXT_FIELDS = [
  ["token_rights", "Rights represented by each token", 2000],
  ["ownership_structure", "Legal ownership structure", 2000],
  ["distribution_rules", "Distribution rules", 2000],
  ["investor_eligibility", "Investor eligibility", 2000],
  ["transfer_restrictions", "Transfer restrictions", 2000],
  ["redemption_terms", "Redemption terms", 2000]
] as const;

export const EVENT_KINDS = {
  valuation_update: "Valuation update",
  custody_update: "Custody update",
  insurance_record: "Insurance record",
  inspection_report: "Inspection report",
  revenue_report: "Revenue report",
  distribution_record: "Distribution record",
  redemption_request: "Redemption request",
  incident: "Incident",
  issuer_report: "Issuer report",
  status_change: "Status change"
} as const;
export type EventKind = keyof typeof EVENT_KINDS;
/** Event kinds an issuer may file (status changes are recorded by NEXORA). */
export const ISSUER_EVENT_KINDS: EventKind[] = ["valuation_update", "custody_update", "insurance_record", "inspection_report", "revenue_report", "distribution_record", "incident", "issuer_report"];

export const SUBSCRIPTION_STATUSES = {
  requested: "Requested",
  accepted: "Accepted by issuer",
  rejected: "Declined",
  authorized: "Trustline authorized",
  delivered: "Tokens delivered",
  cancelled: "Cancelled"
} as const;
export type SubscriptionStatus = keyof typeof SUBSCRIPTION_STATUSES;

export const REFERENCE_PATTERN = /^RWA-\d{4}-[A-Z2-7]{6}$/;
export const TOKEN_CODE_PATTERN = /^[A-Z0-9]{1,12}$/;
export const AMOUNT_PATTERN = /^\d{1,15}(\.\d{1,7})?$/;
