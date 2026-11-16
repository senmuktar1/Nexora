import "server-only";
import type postgres from "postgres";
import { db } from "@/lib/server/db";

type Tx = postgres.Sql<Record<string, unknown>> | postgres.TransactionSql<Record<string, unknown>>;

export type AuditEntry = {
  actor?: { id: string; email: string } | null;
  action: string;
  targetType?: string;
  targetId?: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  reason?: string | null;
  details?: Record<string, unknown>;
};

/** Append-only administrative audit trail. */
export async function audit(entry: AuditEntry, tx: Tx = db()) {
  await tx`insert into admin_audit_log (actor_user_id, actor_email, action, target_type, target_id, previous_status, new_status, reason, details)
    values (${entry.actor?.id ?? null}, ${entry.actor?.email ?? null}, ${entry.action}, ${entry.targetType ?? null}, ${entry.targetId ?? null},
            ${entry.previousStatus ?? null}, ${entry.newStatus ?? null}, ${entry.reason ?? null}, ${tx.json((entry.details ?? {}) as never)})`;
}
