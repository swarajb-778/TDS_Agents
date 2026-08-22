import { NextResponse } from "next/server";
import { startAgentSession } from "@/app/agent-session";
import { redeemAgentToken } from "@/db/agent-tokens";
import { recordAccountAttempt } from "@/db/rate-limit";
import { clientIp } from "../ip";

/**
 * Spend the one-time sign-in link a new signup was emailed.
 *
 * A POST, not the GET the link itself points at. The link opens a page that
 * says who it will sign in and offers a button; the token is only spent when
 * that button is pressed. Mail clients and security scanners follow links in
 * email as a matter of course, and a single-use token that a scanner can burn
 * before the human clicks is a support ticket by design.
 */
export async function POST(request: Request) {
  let body: { token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  const limit = recordAccountAttempt("sign-in-link", token.slice(0, 16), clientIp(request));
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const holder = await redeemAgentToken(token, "sign_in");
  if (!holder) {
    return NextResponse.json(
      {
        error:
          "This link has expired or has already been used. Sign in with your email and password instead.",
      },
      { status: 400 },
    );
  }

  return startAgentSession(NextResponse.json({ ok: true }), holder.agentId);
}
