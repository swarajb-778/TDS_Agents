import { NextResponse } from "next/server";
import { appOrigin } from "@/app/agent-session";
import { passwordProblem } from "@/app/password-rules";
import { signUp } from "@/db/account-flows";
import { looksLikeEmail } from "@/db/accounts";
import { recordAccountAttempt } from "@/db/rate-limit";
import { clientIp } from "../ip";
import { mailConfigured } from "@/mail/send";

/**
 * Create an agent account — or don't, and say exactly the same thing.
 *
 * The response is byte-identical whether the address was free or already had an
 * account: same status, same body, no cookies either way. "That email is
 * already registered" is an account-enumeration oracle, and so is a 409, and so
 * is a Set-Cookie header that only appears on one branch. A scripted attacker
 * reads all three the same way — which is why this route does not sign the new
 * agent in directly.
 *
 * Instead both branches send mail, and the mail is where the difference lives,
 * because the mailbox is the one place the fact is not a leak:
 *
 *   free address  → the account is created, and a one-time link signs them in.
 *   taken address → nothing is created, and the existing account is told that
 *                   someone tried, with a link to sign in or reset instead.
 *
 * The new agent can also just sign in with the password they chose; the link
 * only saves them typing it. See docs — a missed email is never a dead end.
 *
 * No CSRF token here, matching the sign-in route: the double-submit check in
 * db/guard.ts defends a *session*, and there is no session to ride yet. The
 * worst a forged cross-site post can do is cause an email to an address the
 * attacker already knew, which the rate limit below is what actually bounds.
 */
export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";

  // Field errors are about what they typed, never about who exists.
  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = "What should we call you?";
  if (!looksLikeEmail(email)) fieldErrors.email = "That doesn't look like an email address.";
  const problem = passwordProblem(password);
  if (problem) fieldErrors.password = problem;
  if (Object.keys(fieldErrors).length) {
    return NextResponse.json({ fieldErrors }, { status: 400 });
  }

  // Counted before any work, so the cost of a refusal cannot be measured
  // against the cost of a signup.
  const limit = recordAccountAttempt("signup", email, clientIp(request));
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  // Returns void, deliberately: db/account-flows.ts decides which of the two
  // emails to send, and hands this route nothing it could accidentally leak.
  await signUp({ email, name, password }, appOrigin(request));

  return NextResponse.json({ ok: true, delivered: mailConfigured() });
}
