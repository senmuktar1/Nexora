import "server-only";
import { db } from "@/lib/server/db";

/** Platform settings managed by the Super Admin (stored in platform_settings). */
export type PlatformSettings = {
  /** New RWA applications can be started and submitted. */
  applicationsOpen: boolean;
  /** Investors can request subscriptions to published, issued offerings. */
  subscriptionsOpen: boolean;
  /** Days a final tokenization authorization stays valid before issuance. */
  authorizationValidityDays: number;
  /** Require clawback (asset recovery) on authorised RWA tokens. */
  requireClawback: boolean;
  /** Shown on every offering page. */
  riskDisclosure: string;
};

export const DEFAULT_SETTINGS: PlatformSettings = {
  applicationsOpen: true,
  subscriptionsOpen: false,
  authorizationValidityDays: 14,
  requireClawback: true,
  riskDisclosure:
    "Tokenized real-world assets carry significant risk, including total loss. Returns, liquidity and redemption are not guaranteed. " +
    "Information is provided by the issuer; items marked “verified” were checked by NEXORA reviewers against the evidence listed, which is not a guarantee. " +
    "Transfers are restricted to investors the issuer has authorised. This is not investment, legal or tax advice."
};

export async function getSettings(): Promise<PlatformSettings> {
  const rows = await db()`select value from platform_settings where key = 'platform'`;
  return { ...DEFAULT_SETTINGS, ...((rows[0]?.value as Partial<PlatformSettings>) ?? {}) };
}

export function validateSettings(input: Record<string, unknown>): PlatformSettings | null {
  const s = { ...DEFAULT_SETTINGS };
  if (typeof input.applicationsOpen !== "boolean" || typeof input.subscriptionsOpen !== "boolean" || typeof input.requireClawback !== "boolean") return null;
  const days = Number(input.authorizationValidityDays);
  if (!Number.isInteger(days) || days < 1 || days > 90) return null;
  if (typeof input.riskDisclosure !== "string" || input.riskDisclosure.trim().length < 40 || input.riskDisclosure.length > 4000) return null;
  s.applicationsOpen = input.applicationsOpen;
  s.subscriptionsOpen = input.subscriptionsOpen;
  s.requireClawback = input.requireClawback;
  s.authorizationValidityDays = days;
  s.riskDisclosure = input.riskDisclosure.trim();
  return s;
}

export async function saveSettings(settings: PlatformSettings, actorId: string) {
  await db()`insert into platform_settings (key, value, updated_by) values ('platform', ${db().json(settings as never)}, ${actorId})
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`;
}
