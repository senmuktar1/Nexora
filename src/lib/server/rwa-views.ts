import "server-only";
import { db } from "@/lib/server/db";
import { listDocuments, type Row } from "@/lib/server/rwa";
import { FINDING_SUBJECTS, RWA_TEXT_FIELDS, type FindingSubject } from "@/lib/rwa";

const APP_FIELDS = ["reference", "status", "category", ...RWA_TEXT_FIELDS.map(f => f[0]), "valuation_amount", "valuation_currency", "valuation_date",
  "issuer_stellar_address", "info_request", "decision_reason", "published", "created_at", "updated_at", "submitted_at", "decided_at"] as const;

export function pickApplication(app: Row): Row {
  return Object.fromEntries(APP_FIELDS.map(k => [k, app[k] ?? null]));
}

export async function tokenConfigOf(applicationId: string): Promise<Row | null> {
  const rows = await db()`select * from rwa_token_configs where application_id = ${applicationId}`;
  if (!rows[0]) return null;
  const { application_id: _a, authorized_by: _b, ...rest } = rows[0];
  void _a; void _b;
  return rest;
}

/** Latest verification outcome per review subject (issuer declarations vs verified evidence). */
export async function verificationSummary(applicationId: string): Promise<{ subject: string; label: string; status: string; at: string }[]> {
  const rows = await db()`select distinct on (subject) subject, evidence_status, created_at from rwa_findings
    where application_id = ${applicationId} and kind = 'finding' and evidence_status is not null order by subject, created_at desc`;
  return rows.map(r => ({ subject: r.subject as string, label: FINDING_SUBJECTS[r.subject as FindingSubject] ?? "Other", status: r.evidence_status as string, at: String(r.created_at) }));
}

/** What the applicant sees about their own application (no internal reviewer notes). */
export async function ownerView(app: Row): Promise<Row> {
  const id = app.id as string;
  const [documents, history, tokenConfig, events, subscriptions, verification] = await Promise.all([
    listDocuments(id),
    db()`select from_status, to_status, reason, created_at from rwa_status_history where application_id = ${id} order by created_at`,
    tokenConfigOf(id),
    db()`select id, kind, source, title, body, amount, currency, event_date, document_id, tx_hash, public, status, created_at from rwa_asset_events where application_id = ${id} order by created_at desc limit 200`,
    db()`select s.id, s.investor_address, s.amount, s.status, s.authorize_tx_hash, s.delivery_tx_hash, s.decision_reason, s.created_at, u.email as investor_email
      from rwa_subscriptions s join app_users u on u.id = s.investor_user_id where s.application_id = ${id} order by s.created_at desc`,
    verificationSummary(id)
  ]);
  return { application: pickApplication(app), documents, history, tokenConfig, events, subscriptions, verification };
}

/** Public offering view: only published, approved, issued offerings. */
export async function publicOffering(app: Row): Promise<Row | null> {
  const id = app.id as string;
  const cfg = await tokenConfigOf(id);
  if (!app.published || app.status !== "approved" || cfg?.status !== "issued") return null;
  const [documents, events, verification] = await Promise.all([
    listDocuments(id, true),
    db()`select kind, source, title, body, amount, currency, event_date, tx_hash, created_at from rwa_asset_events where application_id = ${id} and public order by created_at desc limit 100`,
    verificationSummary(id)
  ]);
  const a = pickApplication(app);
  return {
    reference: a.reference, category: a.category, asset_name: a.asset_name, description: a.description, country: a.country, jurisdiction: a.jurisdiction,
    issuer_legal_name: a.issuer_legal_name, issuer_registration: a.issuer_registration, custodian: a.custodian, insurance: a.insurance,
    valuation_amount: a.valuation_amount, valuation_currency: a.valuation_currency, valuation_date: a.valuation_date,
    legal_structure: a.legal_structure, redemption_conditions: a.redemption_conditions, status: a.status,
    token: {
      code: cfg.token_code, issuer: cfg.issuer_address, total_supply: cfg.total_supply, price_amount: cfg.price_amount, price_currency: cfg.price_currency,
      min_investment: cfg.min_investment, token_rights: cfg.token_rights, ownership_structure: cfg.ownership_structure, distribution_rules: cfg.distribution_rules,
      investor_eligibility: cfg.investor_eligibility, transfer_restrictions: cfg.transfer_restrictions, redemption_terms: cfg.redemption_terms,
      distributor_address: cfg.distributor_address, clawback_enabled: cfg.clawback_enabled, issued_tx_hash: cfg.issued_tx_hash, issued_at: cfg.issued_at
    },
    documents, events, verification
  };
}
