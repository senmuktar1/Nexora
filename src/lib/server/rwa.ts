import "server-only";
import { randomBytes } from "node:crypto";
import { StrKey } from "@stellar/stellar-sdk";
import type postgres from "postgres";
import { db } from "@/lib/server/db";
import { HttpError } from "@/lib/server/http";
import { audit } from "@/lib/server/audit";
import { decryptBytes, encryptBytes, sha256Hex } from "@/lib/server/crypto";
import { HORIZON } from "@/lib/server/horizon";
import type { PlatformSettings } from "@/lib/server/settings";
import {
  ALLOWED_DOCUMENT_TYPES, AMOUNT_PATTERN, FINDING_SUBJECTS, MAX_DOCUMENT_BYTES, REFERENCE_PATTERN, REQUIRED_DOCUMENTS, RWA_CATEGORIES,
  RWA_DOCUMENT_KINDS, RWA_STATUSES, RWA_TEXT_FIELDS, TOKEN_CODE_PATTERN, TOKEN_TEXT_FIELDS, VERIFICATION_REQUIRED,
  type RwaDocumentKind, type RwaStatus
} from "@/lib/rwa";

export type Row = Record<string, unknown>;
type Tx = postgres.TransactionSql<Record<string, unknown>>;
export type Actor = { id: string; email: string };

/* ───────────── References & lookup ───────────── */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newReference(now = new Date()): string {
  const bytes = randomBytes(6);
  return `RWA-${now.getUTCFullYear()}-${Array.from(bytes, b => B32[b & 31]).join("")}`;
}

export async function findApplication(reference: string): Promise<Row | null> {
  if (!REFERENCE_PATTERN.test(reference)) return null;
  const rows = await db()`select * from rwa_applications where reference = ${reference}`;
  return rows[0] ?? null;
}

/** The application if the signed-in user owns it; 404 otherwise (no existence leak). */
export async function ownedApplication(reference: string, userId: string): Promise<Row> {
  const app = await findApplication(reference);
  if (!app || app.owner_user_id !== userId) throw new HttpError(404, "Application not found.");
  return app;
}

export async function adminApplication(reference: string): Promise<Row> {
  const app = await findApplication(reference);
  if (!app) throw new HttpError(404, "Application not found.");
  return app;
}

export const isEditable = (status: unknown) => status === "draft" || status === "info_requested";

/* ───────────── Application fields ───────────── */

export function parseApplicationUpdate(body: Row): Row {
  const out: Row = {};
  if (body.category !== undefined) {
    if (typeof body.category !== "string" || !(body.category in RWA_CATEGORIES)) throw new HttpError(400, "Choose a valid category.");
    out.category = body.category;
  }
  for (const [key, label, max] of RWA_TEXT_FIELDS) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "string") throw new HttpError(400, "Invalid request.");
    const v = (body[key] as string).trim();
    if (v.length > max) throw new HttpError(400, `${label} is too long (max ${max} characters).`);
    if (key === "asset_name" && v.length < 2) throw new HttpError(400, "Enter the asset name.");
    out[key] = v;
  }
  if (body.valuation_amount !== undefined) {
    const v = body.valuation_amount === null || body.valuation_amount === "" ? null : String(body.valuation_amount).trim();
    if (v !== null && !/^\d{1,15}(\.\d{1,2})?$/.test(v)) throw new HttpError(400, "Enter the valuation as a number (up to 2 decimals).");
    out.valuation_amount = v;
  }
  if (body.valuation_currency !== undefined) {
    const v = body.valuation_currency === null || body.valuation_currency === "" ? null : String(body.valuation_currency).trim().toUpperCase();
    if (v !== null && !/^[A-Z]{3}$/.test(v)) throw new HttpError(400, "Use a 3-letter currency code (e.g. USD).");
    out.valuation_currency = v;
  }
  if (body.valuation_date !== undefined) {
    const v = body.valuation_date === null || body.valuation_date === "" ? null : String(body.valuation_date).trim();
    if (v !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)) || Date.parse(v) > Date.now() + 86_400_000)) throw new HttpError(400, "Enter a valid valuation date (not in the future).");
    out.valuation_date = v;
  }
  if (body.issuer_stellar_address !== undefined) {
    const v = body.issuer_stellar_address === null || body.issuer_stellar_address === "" ? null : String(body.issuer_stellar_address).trim();
    if (v !== null && !StrKey.isValidEd25519PublicKey(v)) throw new HttpError(400, "Enter a valid Stellar public address (G…).");
    out.issuer_stellar_address = v;
  }
  return out;
}

export async function submissionProblems(app: Row): Promise<string[]> {
  const problems: string[] = [];
  for (const [key, label, , required] of RWA_TEXT_FIELDS) if (required && !String(app[key] ?? "").trim()) problems.push(`${label} is required.`);
  if (!app.valuation_amount || !app.valuation_currency || !app.valuation_date) problems.push("Valuation amount, currency and date are required.");
  if (!app.issuer_stellar_address) problems.push("The Stellar address that will issue and distribute the token is required.");
  const kinds = new Set((await db()`select kind from rwa_documents where application_id = ${app.id as string}`).map(r => r.kind as string));
  for (const k of REQUIRED_DOCUMENTS) if (!kinds.has(k)) problems.push(`Upload: ${RWA_DOCUMENT_KINDS[k]}.`);
  return problems;
}

/* ───────────── Status transitions ───────────── */

export const ADMIN_ACTIONS = {
  start_review: { from: ["submitted"], to: "under_review", reason: false },
  request_info: { from: ["submitted", "under_review"], to: "info_requested", reason: true },
  approve: { from: ["under_review"], to: "approved", reason: true },
  reject: { from: ["submitted", "under_review", "info_requested"], to: "rejected", reason: true },
  suspend: { from: ["approved"], to: "suspended", reason: true },
  reinstate: { from: ["suspended"], to: "approved", reason: true }
} as const satisfies Record<string, { from: RwaStatus[]; to: RwaStatus; reason: boolean }>;
export type AdminAction = keyof typeof ADMIN_ACTIONS;

/**
 * Atomic, conditional status change: succeeds only if the status is still `from`
 * (no lost updates). Records history and the audit log in the same transaction.
 */
export async function transition(app: Row, to: RwaStatus, actor: Actor, reason: string | null, opts: { admin: boolean; action: string; tx?: Tx; infoRequest?: string | null }) {
  const run = async (tx: Tx) => {
    const updated = await tx`update rwa_applications set status = ${to}, updated_at = now(),
        submitted_at = case when ${to}::text = 'submitted' then now() else submitted_at end,
        decided_at = case when ${to}::text in ('approved','rejected') then now() else decided_at end,
        decision_reason = case when ${to}::text in ('approved','rejected','suspended') then ${reason}::text else decision_reason end,
        info_request = case when ${to}::text = 'info_requested' then ${opts.infoRequest ?? reason}::text else info_request end,
        published = case when ${to}::text = 'suspended' then false else published end
      where id = ${app.id as string} and status = ${app.status as string} returning id`;
    if (!updated.length) throw new HttpError(409, "This application changed in the meantime. Reload and try again.");
    await tx`insert into rwa_status_history (application_id, actor_user_id, from_status, to_status, reason) values (${app.id as string}, ${actor.id}, ${app.status as string}, ${to}, ${reason})`;
    await tx`insert into rwa_asset_events (application_id, kind, source, title, body, public, author_user_id)
      values (${app.id as string}, 'status_change', ${opts.admin ? "admin" : "issuer"}, ${`Status: ${RWA_STATUSES[to]}`}, ${reason ?? ""}, ${to === "suspended" || to === "approved"}, ${actor.id})`;
    if (opts.admin) await audit({ actor, action: `rwa.${opts.action}`, targetType: "rwa_application", targetId: app.reference as string, previousStatus: app.status as string, newStatus: to, reason }, tx);
  };
  if (opts.tx) await run(opts.tx); else await db().begin(run);
}

/* ───────────── Documents (encrypted at rest) ───────────── */

export function sniffDocumentType(bytes: Buffer): keyof typeof ALLOWED_DOCUMENT_TYPES | null {
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  return base.replace(/[^\w.\- ()]/g, "_").replace(/^\.+/, "").slice(0, 120) || "document";
}

export async function readUpload(request: Request): Promise<{ kind: RwaDocumentKind; file: File }> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_DOCUMENT_BYTES + 64_000) throw new HttpError(413, "Files must be 4 MB or smaller.");
  let form: FormData;
  try { form = await request.formData(); } catch { throw new HttpError(400, "Invalid upload."); }
  const kind = form.get("kind");
  const file = form.get("file");
  if (typeof kind !== "string" || !(kind in RWA_DOCUMENT_KINDS)) throw new HttpError(400, "Choose the document type.");
  if (!(file instanceof File) || file.size === 0) throw new HttpError(400, "Choose a file.");
  if (file.size > MAX_DOCUMENT_BYTES) throw new HttpError(413, "Files must be 4 MB or smaller.");
  return { kind: kind as RwaDocumentKind, file };
}

export async function storeDocument(app: Row, kind: RwaDocumentKind, file: File, uploader: Actor, publicWithOffering = false): Promise<Row> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = sniffDocumentType(bytes);
  if (!mime) throw new HttpError(415, "Upload a PDF, PNG or JPEG file.");
  const count = await db()`select count(*)::int as n from rwa_documents where application_id = ${app.id as string}`;
  if ((count[0].n as number) >= 60) throw new HttpError(400, "This application has too many documents.");
  const id = crypto.randomUUID();
  const { iv, ciphertext } = encryptBytes("document", bytes, id);
  const rows = await db()`insert into rwa_documents (id, application_id, kind, filename, mime, size_bytes, sha256, iv, ciphertext, uploaded_by, public_with_offering)
    values (${id}, ${app.id as string}, ${kind}, ${safeFilename(file.name)}, ${mime}, ${bytes.length}, ${sha256Hex(bytes)}, ${iv}, ${ciphertext}, ${uploader.id}, ${publicWithOffering})
    returning id, kind, filename, mime, size_bytes, sha256, public_with_offering, created_at`;
  return rows[0];
}

export async function listDocuments(applicationId: string, onlyPublic = false): Promise<Row[]> {
  return onlyPublic
    ? db()`select id, kind, filename, mime, size_bytes, sha256, public_with_offering, created_at from rwa_documents where application_id = ${applicationId} and public_with_offering order by created_at`
    : db()`select id, kind, filename, mime, size_bytes, sha256, public_with_offering, created_at from rwa_documents where application_id = ${applicationId} order by created_at`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function loadDocument(id: string): Promise<Row | null> {
  if (!UUID.test(id)) return null;
  const rows = await db()`select d.*, a.owner_user_id, a.reference, a.published, a.status as app_status from rwa_documents d join rwa_applications a on a.id = d.application_id where d.id = ${id}`;
  return rows[0] ?? null;
}

/** Streams a decrypted document as a download that browsers never render inline. */
export function documentResponse(doc: Row): Response {
  const bytes = decryptBytes("document", doc.iv as Buffer, doc.ciphertext as Buffer, doc.id as string);
  if (sha256Hex(bytes) !== doc.sha256) throw new Error("document integrity check failed");
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": doc.mime as string,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${String(doc.filename).replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox"
    }
  });
}

/* ───────────── Token configuration & final authorization ───────────── */

function stroops(amount: string): bigint {
  const [w, f = ""] = amount.split(".");
  return BigInt(w) * 10_000_000n + BigInt((f + "0000000").slice(0, 7));
}
export const sameAmount = (a: unknown, b: unknown) => {
  try { return stroops(String(a)) === stroops(String(b)); } catch { return false; }
};

export function parseTokenConfig(body: Row): Row {
  const out: Row = {};
  const code = String(body.token_code ?? "").trim().toUpperCase();
  if (!TOKEN_CODE_PATTERN.test(code) || code === "XLM") throw new HttpError(400, "Use 1–12 letters or digits for the token code.");
  out.token_code = code;
  for (const [key, label, min] of [["total_supply", "Total supply", true], ["price_amount", "Price per token", true], ["min_investment", "Minimum investment", true]] as const) {
    const v = String(body[key] ?? "").trim();
    if (!AMOUNT_PATTERN.test(v) || !(Number(v) > 0) || (min && stroops(v) <= 0n)) throw new HttpError(400, `${label} must be a positive number (up to 7 decimals).`);
    out[key] = v;
  }
  if (stroops(out.total_supply as string) > 922_337_203_685n * 10_000_000n) throw new HttpError(400, "Total supply is too large.");
  const currency = String(body.price_currency ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{3,12}$/.test(currency)) throw new HttpError(400, "Enter the price currency (e.g. USD or USDC).");
  out.price_currency = currency;
  for (const [key, label, max] of TOKEN_TEXT_FIELDS) {
    const v = String(body[key] ?? "").trim();
    if (v.length < 10) throw new HttpError(400, `${label}: describe this (at least 10 characters).`);
    if (v.length > max) throw new HttpError(400, `${label} is too long.`);
    out[key] = v;
  }
  const dist = String(body.distributor_address ?? "").trim();
  if (!StrKey.isValidEd25519PublicKey(dist)) throw new HttpError(400, "Enter the Stellar address that will distribute the token.");
  out.distributor_address = dist;
  out.clawback_enabled = body.clawback_enabled !== false;
  return out;
}

export type ChecklistItem = { key: string; label: string; ok: boolean; source: "system" | "reviewer" };

/** Every item must be true before an admin can authorise issuance. */
/**
 * Legal clearance evidence: a legal opinion / regulatory clearance DOCUMENT on this
 * application that a reviewer has recorded as verified (finding "legal_clearance" citing
 * it). A typed reference alone is never treated as proof.
 */
export async function legalClearanceEvidence(applicationId: string): Promise<Row[]> {
  return db()`select distinct on (d.id) d.id, d.filename, d.sha256, d.created_at, f.id as finding_id, f.created_at as verified_at
    from rwa_findings f join rwa_documents d on d.id = f.document_id
    where f.application_id = ${applicationId} and d.application_id = ${applicationId} and f.kind = 'finding'
      and f.subject = 'legal_clearance' and f.evidence_status = 'verified' and d.kind = 'legal_opinion'
    order by d.id, f.created_at desc`;
}

export async function authorizationChecklist(app: Row, cfg: Row | null, settings: PlatformSettings, confirmations: Row = {}): Promise<ChecklistItem[]> {
  const legalDocs = await legalClearanceEvidence(app.id as string);
  const selected = typeof confirmations.legalClearanceDocumentId === "string" ? confirmations.legalClearanceDocumentId : "";
  const docs = new Set((await db()`select kind from rwa_documents where application_id = ${app.id as string}`).map(r => r.kind as string));
  const verified = new Set((await db()`select subject from rwa_findings where application_id = ${app.id as string} and kind = 'finding' and evidence_status = 'verified'`).map(r => r.subject as string));
  const configComplete = !!cfg && (() => { try { parseTokenConfig(cfg); return true; } catch { return false; } })();
  return [
    { key: "approved", label: "Application approved", ok: app.status === "approved", source: "system" },
    { key: "offering_docs", label: "Offering documents on file", ok: docs.has("offering"), source: "system" },
    { key: "verified_evidence", label: `Verified findings recorded: ${VERIFICATION_REQUIRED.map(s => FINDING_SUBJECTS[s]).join(", ")}`, ok: VERIFICATION_REQUIRED.every(s => verified.has(s)), source: "system" },
    { key: "config_submitted", label: "Token configuration complete and submitted by the issuer", ok: configComplete && cfg?.status === "submitted", source: "system" },
    { key: "restrictions", label: `Transfer restrictions enforced on-chain (authorization required + revocable${settings.requireClawback ? " + clawback" : ""}) and eligibility rules set`, ok: configComplete && (!settings.requireClawback || cfg?.clawback_enabled === true), source: "system" },
    { key: "issuer_matches", label: "Distribution address matches the issuer's declared Stellar address", ok: !!cfg && cfg.distributor_address === app.issuer_stellar_address, source: "system" },
    { key: "legal_clearance_document", label: "Legal opinion / regulatory clearance document on file and recorded as verified by a reviewer", ok: legalDocs.length > 0, source: "system" },
    { key: "legal_clearance_selected", label: "Verified legal clearance document selected for this authorization", ok: legalDocs.some(d => d.id === selected), source: "reviewer" },
    { key: "counsel_reference", label: "Counsel / regulator reference recorded (describes the document; not evidence on its own)", ok: typeof confirmations.legalClearanceRef === "string" && confirmations.legalClearanceRef.trim().length >= 4, source: "reviewer" },
    { key: "config_matches_offering", label: "Configuration matches the offering documents", ok: confirmations.configMatchesOffering === true, source: "reviewer" },
    { key: "issuer_authorized", label: "Issuer is authorised to tokenize this asset", ok: confirmations.issuerAuthorized === true, source: "reviewer" },
    { key: "deployment", label: "Mainnet issuance explicitly authorised", ok: confirmations.authorizeDeployment === true, source: "reviewer" }
  ];
}

/* ───────────── On-chain verification (Horizon) ───────────── */

export async function horizon(path: string): Promise<Row | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(`${HORIZON}${path}`, { headers: { Accept: "application/json" }, signal: controller.signal, cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`horizon HTTP ${res.status}`);
    return await res.json() as Row;
  } finally {
    clearTimeout(timer);
  }
}

const HASH = /^[0-9a-f]{64}$/;
async function successfulTx(hash: unknown): Promise<{ tx: Row; ops: Row[] }> {
  if (typeof hash !== "string" || !HASH.test(hash.toLowerCase())) throw new HttpError(400, "Enter a valid transaction hash.");
  const h = hash.toLowerCase();
  const tx = await horizon(`/transactions/${h}`);
  if (!tx) throw new HttpError(404, "Transaction not found on Stellar yet. Try again after it confirms.");
  if (tx.successful !== true) throw new HttpError(400, "That transaction failed on Stellar.");
  const ops = await horizon(`/transactions/${h}/operations?limit=200`);
  const records = ((ops?._embedded as Row | undefined)?.records as Row[] | undefined) ?? [];
  return { tx, ops: records };
}

/*
 * Each on-chain step has exactly one acceptable shape. Horizon reports the effective
 * source of every operation in `source_account`. Anything else — extra operations,
 * different order, other sources, destinations, assets, amounts or flags — is refused.
 */
const ISSUANCE_STARTING_BALANCE = "1.5";
const SET_OPTIONS_FORBIDDEN = ["clear_flags", "master_key_weight", "low_threshold", "med_threshold", "high_threshold", "signer_key", "signer_weight", "inflation_dest", "home_domain"];

function flagList(op: Row): number[] {
  const raw = op.set_flags;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return [-1];
  return raw.map(Number).sort((a, b) => a - b);
}
const sameFlags = (op: Row, expected: number[]) => JSON.stringify(flagList(op)) === JSON.stringify([...expected].sort((a, b) => a - b));
const noClearFlags = (op: Row) => op.clear_flags === undefined || op.clear_flags === null || (Array.isArray(op.clear_flags) && op.clear_flags.length === 0);
function isAsset(op: Row, code: string, issuer: string) {
  return op.asset_type !== "native" && op.asset_code === code && op.asset_issuer === issuer;
}
function reject(message: string): never { throw new HttpError(400, message); }

function expectShape(tx: Row, ops: Row[], source: string, types: string[], what: string) {
  if (tx.source_account !== source) reject(`The ${what} wasn't sent from the expected Stellar address.`);
  // Horizon always reports operation_count; it must be a positive integer equal to the records returned.
  const count = tx.operation_count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 100) reject(`The ${what} has no valid operation count on Stellar.`);
  if (count !== ops.length) reject(`The ${what} couldn't be read completely: Stellar reports ${count} operations but ${ops.length} were returned.`);
  if (ops.length !== types.length || ops.some((o, i) => o.type !== types[i])) {
    reject(`The ${what} must contain exactly: ${types.join(", ")}. It contains other or additional operations.`);
  }
  if (ops.some(o => o.transaction_successful === false)) reject(`The ${what} failed on Stellar.`);
}

/**
 * Issuance (built by the issuer's wallet from the authorised configuration):
 *   0 create_account        source D, funder D → new issuer I, starting balance 1.5 XLM
 *   1 set_options           source I, set_flags exactly {1,2[,8]}, nothing else
 *   2 change_trust          source D (trustor D) for CODE:I
 *   3 set_trust_line_flags  source I, trustor D, CODE:I, set authorized only
 *   4 payment               source I, from I → D, CODE:I, amount = total supply
 */
export function checkIssuanceOps(tx: Row, ops: Row[], cfg: Row): { issuer: string } {
  const D = cfg.distributor_address as string, code = cfg.token_code as string;
  expectShape(tx, ops, D, ["create_account", "set_options", "change_trust", "set_trust_line_flags", "payment"], "issuance transaction");
  const [create, options, trust, authorize, mint] = ops;
  const I = create.account as string;
  if (create.source_account !== D || create.funder !== D || typeof I !== "string" || !StrKey.isValidEd25519PublicKey(I) || I === D || !sameAmount(create.starting_balance, ISSUANCE_STARTING_BALANCE)) {
    reject("The issuer account wasn't created as authorised.");
  }
  if (options.source_account !== I || !sameFlags(options, cfg.clawback_enabled ? [1, 2, 8] : [1, 2]) || !noClearFlags(options)
    || SET_OPTIONS_FORBIDDEN.some(k => options[k] !== undefined && options[k] !== null && options[k] !== "")) {
    reject(Number(options.master_key_weight) === 0 && options.master_key_weight !== undefined
      ? "The issuer was locked, so investor trustlines could never be authorised."
      : "The token wasn't issued with exactly the required transfer controls.");
  }
  if (trust.source_account !== D || (trust.trustor !== undefined && trust.trustor !== D) || !isAsset(trust, code, I)) reject("The distribution trustline doesn't match the authorised token.");
  if (authorize.source_account !== I || authorize.trustor !== D || !isAsset(authorize, code, I) || !sameFlags(authorize, [1]) || !noClearFlags(authorize)) {
    reject("The distribution account wasn't authorised as expected.");
  }
  if (mint.source_account !== I || mint.from !== I || mint.to !== D || !isAsset(mint, code, I) || !sameAmount(mint.amount, cfg.total_supply)) {
    reject("The minted amount, token code or recipient doesn't match the authorised configuration.");
  }
  return { issuer: I };
}

/** Trustline authorisation: exactly one set_trust_line_flags by the issuer for this investor and token. */
export function checkTrustlineAuthorizationOps(tx: Row, ops: Row[], expected: { distributor: string; issuer: string; code: string; investor: string }) {
  expectShape(tx, ops, expected.distributor, ["set_trust_line_flags"], "authorisation transaction");
  const op = ops[0];
  if (op.source_account !== expected.issuer || op.trustor !== expected.investor || !isAsset(op, expected.code, expected.issuer) || !sameFlags(op, [1]) || !noClearFlags(op)) {
    reject("This transaction didn't authorise the investor's trustline for this token.");
  }
}

/** Delivery: exactly one payment of the subscribed amount from the distribution account to the investor. */
export function checkDeliveryOps(tx: Row, ops: Row[], expected: { distributor: string; issuer: string; code: string; investor: string; amount: string }) {
  expectShape(tx, ops, expected.distributor, ["payment"], "delivery transaction");
  const op = ops[0];
  if (op.source_account !== expected.distributor || op.from !== expected.distributor || op.to !== expected.investor || !isAsset(op, expected.code, expected.issuer) || !sameAmount(op.amount, expected.amount)) {
    reject("This transaction didn't deliver the subscribed amount to the investor.");
  }
}

/** Confirms the issuance transaction created exactly the authorised, restricted token. */
export async function verifyIssuance(hash: unknown, cfg: Row): Promise<{ issuer: string; hash: string }> {
  const { tx, ops } = await successfulTx(hash);
  const { issuer } = checkIssuanceOps(tx, ops, cfg);
  const account = await horizon(`/accounts/${issuer}`);
  const af = (account?.flags ?? {}) as Row;
  if (!account || af.auth_required !== true || af.auth_revocable !== true || (cfg.clawback_enabled && af.auth_clawback_enabled !== true)) {
    reject("The issuer account doesn't currently have the required transfer controls.");
  }
  const master = ((account.signers as { key: string; weight: number }[] | undefined) ?? []).find(x => x.key === issuer);
  if (account.signers !== undefined && (!master || Number(master.weight) === 0)) reject("The issuer key can't sign, so investor trustlines could never be authorised.");
  return { issuer, hash: String(hash).toLowerCase() };
}

export async function verifyTrustlineAuthorization(hash: unknown, expected: { distributor: string; issuer: string; code: string; investor: string }): Promise<string> {
  const { tx, ops } = await successfulTx(hash);
  checkTrustlineAuthorizationOps(tx, ops, expected);
  return String(hash).toLowerCase();
}

export async function verifyDelivery(hash: unknown, expected: { distributor: string; issuer: string; code: string; investor: string; amount: string }): Promise<string> {
  const { tx, ops } = await successfulTx(hash);
  checkDeliveryOps(tx, ops, expected);
  return String(hash).toLowerCase();
}

export type RecordedStep = "issuance" | "authorization" | "delivery";

/**
 * Fast pre-check (avoids a Horizon round trip for an obviously reused hash). It is NOT
 * the guarantee: `recordOnChainStep` enforces uniqueness atomically.
 */
export async function txHashAlreadyUsed(hash: unknown): Promise<boolean> {
  const h = String(hash ?? "").toLowerCase();
  if (!HASH.test(h)) return false;
  return (await db()`select 1 from rwa_recorded_transactions where tx_hash = ${h}`).length > 0;
}

export class TxHashReused extends HttpError {
  constructor() { super(409, "This transaction was already recorded."); }
}

/**
 * Atomically reserves a transaction hash (globally unique across issuance, trustline
 * authorisation and delivery, for every application and subscription) and records the
 * step in the same database transaction. `apply` performs the conditional status update
 * and must return false if the expected state no longer holds; then everything rolls back,
 * including the reservation. A concurrent second attempt with the same hash waits on the
 * primary key and then fails with 409, whichever subscription or step it targets.
 */
export async function recordOnChainStep(
  hash: string, step: RecordedStep, ids: { applicationId: string; subscriptionId?: string | null },
  apply: (tx: Tx) => Promise<boolean>, conflictMessage = "This request changed in the meantime. Reload and try again."
): Promise<void> {
  const h = hash.toLowerCase();
  if (!HASH.test(h)) throw new HttpError(400, "Enter a valid transaction hash.");
  try {
    await db().begin(async tx => {
      const reserved = await tx`insert into rwa_recorded_transactions (tx_hash, step, application_id, subscription_id)
        values (${h}, ${step}, ${ids.applicationId}, ${ids.subscriptionId ?? null}) on conflict (tx_hash) do nothing returning tx_hash`;
      if (!reserved.length) throw new TxHashReused();
      if (!(await apply(tx))) throw new HttpError(409, conflictMessage);
    });
  } catch (e) {
    // A unique-index violation on the step columns is the same reuse condition.
    if (e && typeof e === "object" && (e as { code?: string }).code === "23505") throw new TxHashReused();
    throw e;
  }
}
