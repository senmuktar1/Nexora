import "server-only";
import type { NextRequest } from "next/server";
import { db } from "@/lib/server/db";
import { HttpError, str } from "@/lib/server/http";
import { storeDocument, type Actor, type Row } from "@/lib/server/rwa";
import { EVENT_KINDS, MAX_DOCUMENT_BYTES, RWA_DOCUMENT_KINDS, type EventKind, type RwaDocumentKind } from "@/lib/rwa";

const DOC_KIND_FOR_EVENT: Partial<Record<EventKind, RwaDocumentKind>> = {
  valuation_update: "valuation", custody_update: "custody", insurance_record: "insurance", inspection_report: "inspection"
};

/** Parses a lifecycle event (JSON or multipart with an optional document) and stores it. */
export async function recordEvent(request: NextRequest, app: Row, actor: Actor, source: "issuer" | "admin", allowed: readonly EventKind[]): Promise<Row> {
  const isForm = (request.headers.get("content-type") ?? "").startsWith("multipart/form-data");
  let fields: Record<string, unknown> = {};
  let file: File | null = null;
  if (isForm) {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_DOCUMENT_BYTES + 64_000) throw new HttpError(413, "Files must be 4 MB or smaller.");
    const form = await request.formData().catch(() => { throw new HttpError(400, "Invalid upload."); });
    for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v;
    const f = form.get("file");
    if (f instanceof File && f.size > 0) file = f;
  } else {
    const text = await request.text();
    if (text.length > 64_000) throw new HttpError(413, "Request too large.");
    try { fields = JSON.parse(text); } catch { throw new HttpError(400, "Invalid request."); }
  }
  const kind = fields.kind as EventKind;
  if (typeof kind !== "string" || !(kind in EVENT_KINDS) || !allowed.includes(kind)) throw new HttpError(400, "Choose a valid record type.");
  const title = str(fields.title, 160);
  if (title.length < 3) throw new HttpError(400, "Enter a title.");
  const body = str(fields.body, 4000);
  const amount = str(fields.amount, 30) || null;
  if (amount && !/^\d{1,15}(\.\d{1,7})?$/.test(amount)) throw new HttpError(400, "Enter the amount as a number.");
  const currency = str(fields.currency, 12).toUpperCase() || null;
  if (currency && !/^[A-Z0-9]{3,12}$/.test(currency)) throw new HttpError(400, "Enter a valid currency code.");
  const eventDate = str(fields.event_date, 10) || null;
  if (eventDate && (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || Number.isNaN(Date.parse(eventDate)))) throw new HttpError(400, "Enter a valid date.");
  const txHash = str(fields.tx_hash, 64).toLowerCase() || null;
  if (txHash && !/^[0-9a-f]{64}$/.test(txHash)) throw new HttpError(400, "Enter a valid transaction hash.");
  const share = fields.public === true || fields.public === "true";
  if (file && file.size > MAX_DOCUMENT_BYTES) throw new HttpError(413, "Files must be 4 MB or smaller.");
  const doc = file ? await storeDocument(app, DOC_KIND_FOR_EVENT[kind] ?? "report", file, actor, share) : null;
  const rows = await db()`insert into rwa_asset_events (application_id, kind, source, title, body, amount, currency, event_date, document_id, tx_hash, public, status, author_user_id)
    values (${app.id as string}, ${kind}, ${source}, ${title}, ${body}, ${amount}, ${currency}, ${eventDate}, ${(doc?.id as string) ?? null}, ${txHash}, ${share},
            ${kind === "incident" ? "pending_review" : "recorded"}, ${actor.id})
    returning id, kind, source, title, body, amount, currency, event_date, document_id, tx_hash, public, status, created_at`;
  return { ...rows[0], document: doc ? { id: doc.id, filename: doc.filename, kind: RWA_DOCUMENT_KINDS[doc.kind as RwaDocumentKind] } : null };
}
