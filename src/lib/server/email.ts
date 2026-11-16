import "server-only";
import { db } from "@/lib/server/db";

/**
 * Transactional email (verification links). Production uses Resend's HTTPS API with
 * RESEND_API_KEY + EMAIL_FROM. EMAIL_TEST_OUTBOX=true writes messages to a database
 * table instead — for local automated tests only; it is refused on Vercel/Netlify.
 */
export class EmailUnavailable extends Error { constructor() { super("email_not_configured"); } }

export function emailMode(env: NodeJS.ProcessEnv = process.env): "resend" | "test-outbox" | "none" {
  if (env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim()) return "resend";
  if (env.EMAIL_TEST_OUTBOX === "true" && !env.VERCEL && !env.NETLIFY) return "test-outbox";
  return "none";
}

export async function sendEmail(message: { to: string; subject: string; text: string }): Promise<void> {
  const mode = emailMode();
  if (mode === "test-outbox") {
    await db()`insert into email_outbox (to_email, subject, body) values (${message.to}, ${message.subject}, ${message.text})`;
    return;
  }
  if (mode === "none") throw new EmailUnavailable();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM!.trim(), to: [message.to], subject: message.subject, text: message.text }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`email provider HTTP ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}
