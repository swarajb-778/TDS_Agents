import { NextResponse } from "next/server";
import { appOrigin } from "@/app/agent-session";
import { requestPasswordReset } from "@/db/account-flows";
import { looksLikeEmail } from "@/db/accounts";
import { recordAccountAttempt } from "@/db/rate-limit";
import { clientIp } from "../../ip";
import { mailConfigured } from "@/mail/send";

/**
 * "Email me a reset link."
 *
 * Same rule as signup, for the same reason: an unknown address and a known one
 * produce the identical response. This one is easier to get right — nothing is
 * returned but `{ ok: true }` in either case — and easier to get wrong, because
 * the honest-looking "no account with that email" message is precisely the
 * oracle. The person who needs to know whether an account exists is the person
 * holding the mailbox, and they find out by receiving mail or not.
 *
 * Rate limited per address and per IP: an endpoint that mails a named address
 * on demand is a mail bomb otherwise, and the address is chosen by the caller.
 */
export async function POST(request: Request) {
  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email : "";
  if (!looksLikeEmail(email)) {
    return NextResponse.json(
      { fieldErrors: { email: "That doesn't look like an email address." } },
      { status: 400 },
    );
  }

  const limit = recordAccountAttempt("reset-request", email, clientIp(request));
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: `Too many requests. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  /*
   * Returns void: an address with an account and one without are the same call
   * from here, and there is nothing to turn into a status code.
   *
   * Known residual, stated rather than hidden: the miss branch skips a token
   * insert, so a hit is very slightly slower. Unlike the sign-in path there is
   * no KDF in play, so the gap is one small INSERT rather than ~100ms of
   * scrypt; closing it properly means writing throwaway rows on every miss,
   * which trades a real cost for a marginal one.
   */
  await requestPasswordReset(email, appOrigin(request));

  return NextResponse.json({ ok: true, delivered: mailConfigured() });
}
