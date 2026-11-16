import { fail, json, readJson, route } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/auth/guard";
import { audit } from "@/lib/server/audit";
import { getSettings, saveSettings, validateSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route("admin:settings", async request => {
  await requireAdmin(request, "settings.manage");
  return json({ settings: await getSettings() });
});

export const PUT = route("admin:settings-save", async request => {
  const session = await requireAdmin(request, "settings.manage", { mutate: true });
  const next = validateSettings(await readJson(request));
  if (!next) return fail("Check the settings: validity 1–90 days and a risk disclosure of at least 40 characters.");
  const previous = await getSettings();
  await saveSettings(next, session.user.id);
  const changed = Object.keys(next).filter(k => JSON.stringify(next[k as keyof typeof next]) !== JSON.stringify(previous[k as keyof typeof previous]));
  await audit({ actor: { id: session.user.id, email: session.user.email }, action: "platform.settings.updated", targetType: "settings", targetId: "platform", details: { changed } });
  return json({ ok: true, settings: next });
});
