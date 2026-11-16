import { db } from "@/lib/server/db";
import { fail, isAdminHost, json, route } from "@/lib/server/http";
import { getSession } from "@/lib/server/auth/session";
import { getSettings } from "@/lib/server/settings";
import { findApplication } from "@/lib/server/rwa";
import { publicOffering } from "@/lib/server/rwa-views";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route<{ ref: string }>("rwa:offering", async (request, { ref }) => {
  if (isAdminHost(request.headers.get("host"))) return fail("Not found.", 404);
  const app = await findApplication(ref);
  const offering = app ? await publicOffering(app) : null;
  if (!app || !offering) return fail("Offering not found.", 404);
  const settings = await getSettings();
  const session = await getSession(request, "public");
  const mine = session ? await db()`select id, investor_address, amount, status, authorize_tx_hash, delivery_tx_hash, decision_reason, created_at
    from rwa_subscriptions where application_id = ${app.id as string} and investor_user_id = ${session.user.id} order by created_at desc` : [];
  return json({
    offering,
    riskDisclosure: settings.riskDisclosure,
    subscriptionsOpen: settings.subscriptionsOpen,
    viewer: session ? { signedIn: true, verified: !!session.user.email_verified_at, isIssuer: session.user.id === app.owner_user_id } : { signedIn: false },
    mySubscriptions: mine
  });
});
