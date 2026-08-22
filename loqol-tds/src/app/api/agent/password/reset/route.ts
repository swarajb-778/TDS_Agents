import { NextResponse } from "next/server";
import { appOrigin, startAgentSession } from "@/app/agent-session";
import { passwordProblem } from "@/app/password-rules";
import { changePassword } from "@/db/accounts";
import { redeemAgentToken } from "@/db/agent-tokens";
import { recordAccountAttempt } from "@/db/rate-limit";
import { sendPasswordChanged } from "@/mail/auth-mail";
import { clientIp } from "../../ip";

/**
 * Spend a reset link and set the new password.
 *
 * The token is redeemed with a conditional UPDATE, so it is single-use even if
 * two tabs submit at once (db/agent-tokens.ts). Setting the password then
 * cancels every other outstanding link for that agent — someone resetting after
 * a scare should not leave a spare key in the mailbox.
 *
 * They are signed in on success. They have just proved control of the mailbox
 * *and* set the password; bouncing them to a login form to type it again is
 * friction with nothing behind it.
 *
 * Note what is not done: existing session cookies are not invalidated, because
 * the session is a stateless HMAC with no revocation list — a documented
 * trade-off in db/auth.ts, and the honest statement is that a reset locks out
 * whoever holds the old *password*, not whoever holds an old *cookie*, for up
 * to the 12-hour session lifetime.
 */
export async function POST(request: Request) {
  let body: { token?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";

  const problem = passwordProblem(password);
  if (problem) {
    return NextResponse.json({ fieldErrors: { password: problem } }, { status: 400 });
  }

  // Keyed on the token rather than an address: at this point we have no address
  // to key on, and the token is what an attacker would be hammering. 256 bits
  // is not guessable anyway — this bounds the damage if a link leaks into a
  // referrer log and someone starts replaying it.
  const limit = recordAccountAttempt("reset-submit", token.slice(0, 16), clientIp(request));
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const holder = await redeemAgentToken(token, "password_reset");
  if (!holder) {
    // One message for expired, already used, and never existed. Which of the
    // three it was is not information the holder of a bad link is owed.
    return NextResponse.json(
      { error: "This link has expired or has already been used. Request a new one." },
      { status: 400 },
    );
  }

  await changePassword(holder.agentId, password);
  await sendPasswordChanged(
    holder.email,
    holder.name,
    `${appOrigin(request)}/agent/forgot-password`,
  );

  return startAgentSession(NextResponse.json({ ok: true }), holder.agentId);
}
