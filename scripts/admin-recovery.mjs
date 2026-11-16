#!/usr/bin/env node
// NEXORA administrator recovery — run by the owner with direct database access.
// It never runs from the web app, and every change is written to the audit log.
//
//   DATABASE_URL=... npm run admin:recovery -- status
//   DATABASE_URL=... npm run admin:recovery -- change-email --from old@x.com --to new@y.com --confirm
//        then set NEXORA_ADMIN_EMAIL=new@y.com in the hosting environment and redeploy.
//   DATABASE_URL=... npm run admin:recovery -- reset-mfa --email founder@x.com --confirm
//        next sign-in requires enrolling a new authenticator.
//   DATABASE_URL=... npm run admin:recovery -- reset-password --email founder@x.com --confirm
//        reads the new password from standard input (not from the command line).
//   DATABASE_URL=... npm run admin:recovery -- unlock --email founder@x.com
//        clears sign-in lockouts for that email.
import { randomBytes, scrypt } from "node:crypto";
import postgres from "postgres";

const [cmd, ...rest] = process.argv.slice(2);
const arg = name => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const confirmed = rest.includes("--confirm");
const email = v => (v ?? "").trim().toLowerCase();
const fail = msg => { console.error(msg); process.exit(1); };

if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set.");
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
const audit = (action, details) => sql`insert into admin_audit_log (action, target_type, target_id, details) values (${action}, 'user', ${details.email ?? null}, ${sql.json({ ...details, via: "recovery-cli" })})`;

async function readPassword() {
  process.stdout.write("New password (min 12 characters), then Enter: ");
  const chunks = [];
  for await (const c of process.stdin) { chunks.push(c); if (String(c).includes("\n")) break; }
  return Buffer.concat(chunks.map(c => Buffer.from(c))).toString().split(/\r?\n/)[0];
}
function hash(password) {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => scrypt(password.normalize("NFKC"), salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, key) => e ? reject(e) : resolve(`scrypt$32768$8$1$${salt.toString("base64")}$${key.toString("base64")}`)));
}

try {
  const admin = (await sql`select id, email, status, mfa_enabled from app_users where role = 'super_admin'`)[0];
  if (cmd === "status") {
    const boot = (await sql`select completed_at from admin_bootstrap`)[0];
    console.log(JSON.stringify({ bootstrapCompleted: !!boot, completedAt: boot?.completed_at ?? null, superAdmin: admin ? { email: admin.email, status: admin.status, mfaEnabled: admin.mfa_enabled } : null }, null, 2));
  } else if (cmd === "change-email") {
    const from = email(arg("from")), to = email(arg("to"));
    if (!admin) fail("There is no Super Admin account.");
    if (!from || !to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) fail("Usage: change-email --from <current> --to <new> --confirm");
    if (admin.email !== from) fail("--from doesn't match the current Super Admin email.");
    if (!confirmed) fail("Add --confirm to change the Super Admin email. All admin sessions will be signed out.");
    await sql.begin(async tx => {
      await tx`update app_users set email = ${to}, updated_at = now() where id = ${admin.id}`;
      await tx`update admin_bootstrap set admin_email = ${to}`;
      await tx`delete from sessions where user_id = ${admin.id}`;
      await tx`insert into admin_audit_log (action, target_type, target_id, details) values ('admin.recovery.email_changed', 'user', ${to}, ${tx.json({ from, to, via: "recovery-cli" })})`;
    });
    console.log(`Super Admin email changed to ${to}. Now set NEXORA_ADMIN_EMAIL=${to} and redeploy; until then nobody can sign in.`);
  } else if (cmd === "reset-mfa" || cmd === "reset-password" || cmd === "unlock") {
    const e = email(arg("email"));
    const user = (await sql`select id, email from app_users where realm = 'admin' and email = ${e}`)[0];
    if (!user) fail("No administrator account with that email.");
    if (cmd === "unlock") {
      await sql`delete from login_attempts where key = ${`admin:${e}`}`;
      await audit("admin.recovery.unlocked", { email: e });
      console.log("Sign-in lockout cleared.");
    } else if (!confirmed) {
      fail(`Add --confirm to ${cmd === "reset-mfa" ? "remove two-factor authentication (re-enrolment required at next sign-in)" : "set a new password"}.`);
    } else if (cmd === "reset-mfa") {
      await sql`update app_users set mfa_enabled = false, mfa_secret_enc = null, mfa_last_step = null, recovery_codes = '[]'::jsonb, updated_at = now() where id = ${user.id}`;
      await sql`delete from sessions where user_id = ${user.id}`;
      await audit("admin.recovery.mfa_reset", { email: e });
      console.log("Two-factor authentication removed. Sign in and enrol a new authenticator.");
    } else {
      const pw = await readPassword();
      if (pw.length < 12 || pw.length > 200) fail("\nUse 12–200 characters.");
      await sql`update app_users set password_hash = ${await hash(pw)}, updated_at = now() where id = ${user.id}`;
      await sql`delete from sessions where user_id = ${user.id}`;
      await audit("admin.recovery.password_reset", { email: e });
      console.log("\nPassword changed; all sessions signed out.");
    }
  } else {
    console.log("Commands: status | change-email --from <a> --to <b> --confirm | reset-mfa --email <a> --confirm | reset-password --email <a> --confirm | unlock --email <a>");
    process.exitCode = cmd ? 1 : 0;
  }
} catch (e) {
  console.error("Failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
