/**
 * The mail seam.
 *
 * There is no provider wired up, deliberately: the interesting part of the
 * account flow is what gets sent and to whom, not SMTP. So this logs the
 * message server-side and keeps the last few in memory for the checks in
 * scripts/db-check.ts to read.
 *
 * ---------------------------------------------------------------------------
 * A REAL PROVIDER PLUGS IN AT `deliver()` BELOW.
 *
 * Every provider worth using (Resend, Postmark, SES, Sendgrid) is one POST
 * with these same three fields, so the swap is a body and a bearer token:
 *
 *   await fetch("https://api.resend.com/emails", {
 *     method: "POST",
 *     headers: {
 *       Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
 *       "Content-Type": "application/json",
 *     },
 *     body: JSON.stringify({ from: FROM, to: message.to, subject, text }),
 *   });
 *
 * Nothing above this file needs to change when that happens — callers already
 * treat delivery as fire-and-forget and never branch on the result. See the
 * note on `sendEmail` for why that matters.
 * ---------------------------------------------------------------------------
 */

export interface Email {
  to: string;
  subject: string;
  /** Plain text. Nothing here needs HTML, and text cannot be a phishing vector. */
  body: string;
}

/**
 * The last few messages, for `npm run db:check` and for eyeballing in dev.
 *
 * Never populated in production: these bodies contain live one-time links, and
 * holding them in process memory would put a working password-reset link in
 * every heap dump.
 */
const OUTBOX_LIMIT = 50;
const outbox: Email[] = [];
const capture = () => process.env.NODE_ENV !== "production";

async function deliver(message: Email): Promise<void> {
  // Replace this body with the provider call described above.
  console.log(
    [
      "",
      "─── email (not sent — no provider configured) ───",
      `to:      ${message.to}`,
      `subject: ${message.subject}`,
      "",
      message.body,
      "────────────────────────────────────────────────",
      "",
    ].join("\n"),
  );
}

/**
 * Send, and never throw.
 *
 * This is load-bearing rather than lazy. Signup and password-reset both send
 * mail on one branch of a decision the caller must not reveal — if a delivery
 * failure could turn into a different status code or a slower response, the
 * mailer would become the account-enumeration oracle those routes go out of
 * their way to avoid. So a failure is logged and swallowed, and the caller
 * always sees the same nothing.
 */
export async function sendEmail(message: Email): Promise<void> {
  if (capture()) {
    outbox.push(message);
    if (outbox.length > OUTBOX_LIMIT) outbox.shift();
  }
  try {
    await deliver(message);
  } catch (error) {
    // Detailed on the server, invisible to the caller. Both are intentional.
    console.error(`email to ${message.to} failed to send`, error);
  }
}

/** Dev and test only — always empty in production. */
export function recentEmails(): readonly Email[] {
  return outbox;
}

/** Dev and test only. */
export function clearOutbox(): void {
  outbox.length = 0;
}
