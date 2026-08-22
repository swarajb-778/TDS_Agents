import { NextResponse } from "next/server";
import { appOrigin } from "@/app/agent-session";
import { passwordProblem } from "@/app/password-rules";
import { changePassword, passwordMatches } from "@/db/accounts";
import { agentForMutation } from "@/db/guard";
import { clearAccountAttempts, recordAccountAttempt } from "@/db/rate-limit";
import { sendPasswordChanged } from "@/mail/auth-mail";
import { clientIp } from "../../ip";

const ACTION = "password-change";

/**
 * Change the password from inside a live session.
 *
 * The current password is required, and that is not ceremony: a session cookie
 * on a borrowed laptop should not be enough to take an account away from its
 * owner. Re-proving the password is what stops a stolen session becoming a
 * permanent one.
 *
 * Throttled like any other credential check, because "guess the current
 * password" is exactly what an attacker sitting on a stolen session would do,
 * and this endpoint would otherwise be an unlimited oracle for it.
 */
export async function POST(request: Request) {
  const auth = await agentForMutation();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  const problem = passwordProblem(newPassword);
  if (problem) {
    return NextResponse.json({ fieldErrors: { newPassword: problem } }, { status: 400 });
  }

  const limit = recordAccountAttempt(ACTION, auth.agent.email, clientIp(request));
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  if (!(await passwordMatches(auth.agent.id, currentPassword))) {
    return NextResponse.json(
      { fieldErrors: { currentPassword: "That's not your current password." } },
      { status: 400 },
    );
  }
  clearAccountAttempts(ACTION, auth.agent.email);

  await changePassword(auth.agent.id, newPassword);
  // To the account's own address, so a change made by someone else is visible
  // to the person it was taken from.
  await sendPasswordChanged(
    auth.agent.email,
    auth.agent.name,
    `${appOrigin(request)}/agent/forgot-password`,
  );

  return NextResponse.json({ ok: true });
}
