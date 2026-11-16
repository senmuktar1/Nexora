"use client";

import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, CircleDashed, ShieldCheck, ShieldQuestion, XCircle } from "lucide-react";
import { EVIDENCE_STATUS, RWA_STATUSES, SUBSCRIPTION_STATUSES, TOKEN_CONFIG_STATUSES } from "@/lib/rwa";

const TONE: Record<string, "good" | "warn" | "bad" | "info" | "muted"> = {
  draft: "muted", submitted: "info", under_review: "info", info_requested: "warn", approved: "good", rejected: "bad", suspended: "bad",
  authorized: "good", issued: "good", revoked: "bad", requested: "info", accepted: "info", delivered: "good", cancelled: "muted",
  pending_review: "warn", acknowledged: "info", resolved: "good", recorded: "muted",
  verified: "good", declared: "warn", not_verified: "bad", active: "good", pending: "warn"
};
const COMMON: Record<string, string> = {
  ...EVIDENCE_STATUS, pending_review: "Pending review", acknowledged: "Acknowledged", resolved: "Resolved", recorded: "Recorded", rejected: "Rejected",
  active: "Active", pending: "Unverified email", suspended: "Suspended"
};
const LABELS = {
  application: { ...COMMON, ...RWA_STATUSES } as Record<string, string>,
  token: { ...COMMON, ...TOKEN_CONFIG_STATUSES } as Record<string, string>,
  subscription: { ...COMMON, ...SUBSCRIPTION_STATUSES } as Record<string, string>,
  other: COMMON
};

/** `kind` selects the vocabulary: the same key (e.g. "submitted", "authorized") means different things. */
export function StatusBadge({ status, label, kind = "application" }: { status: string; label?: string; kind?: keyof typeof LABELS }) {
  const tone = TONE[status] ?? "muted";
  const Icon = tone === "good" ? CheckCircle2 : tone === "bad" ? XCircle : tone === "warn" ? AlertCircle : CircleDashed;
  return <span className={`nx-rwa-badge nx-rwa-badge-${tone}`}><Icon size={12}/>{label ?? LABELS[kind][status] ?? status}</span>;
}

export function EvidenceBadge({ status }: { status: string }) {
  const Icon = status === "verified" ? ShieldCheck : ShieldQuestion;
  return <span className={`nx-rwa-badge nx-rwa-badge-${TONE[status] ?? "muted"}`}><Icon size={12}/>{LABELS.other[status] ?? status}</span>;
}

export function Field({ label, hint, children, wide = false }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return <label className={wide ? "nx-rwa-field nx-rwa-field-wide" : "nx-rwa-field"}>
    <span className="nx-wallet-field-label">{label}</span>
    {children}
    {hint && <small>{hint}</small>}
  </label>;
}

export function Notice({ kind, children }: { kind: "error" | "success" | "info"; children: ReactNode }) {
  return <div className={`nx-rwa-notice nx-rwa-notice-${kind}`} role={kind === "error" ? "alert" : "status"}>{children}</div>;
}

export function Section({ kicker, title, actions, children, id }: { kicker?: string; title: string; actions?: ReactNode; children: ReactNode; id?: string }) {
  return <section className="nx-panel nx-rwa-section" id={id}>
    <div className="nx-panel-header"><div>{kicker && <div className="nx-panel-kicker">{kicker}</div>}<h2>{title}</h2></div>{actions}</div>
    {children}
  </section>;
}

export function Facts({ items }: { items: [string, ReactNode][] }) {
  return <dl className="nx-rwa-facts">{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || "—"}</dd></div>)}</dl>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="nx-rwa-empty">{children}</p>;
}
