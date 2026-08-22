/**
 * One definition of what "signed in as an agent" looks like on the wire.
 *
 * Four routes now hand out a session — sign in, the emailed sign-in link, a
 * completed password reset, and signup's own follow-through. Cookie flags that
 * are copy-pasted four times are cookie flags that end up disagreeing, and the
 * one that quietly loses `httpOnly` is the one nobody notices.
 *
 * Lives in app/ rather than db/ because it is about the HTTP response, not the
 * database — same reason csrf.ts is here.
 */

import type { NextResponse } from "next/server";
import { CSRF_COOKIE, SESSION_COOKIE, issueSession, newCsrfToken } from "@/db/auth";

/** Set the session and CSRF cookies on a response. Returns it for chaining. */
export function startAgentSession<T extends NextResponse>(
  response: T,
  agentId: string,
): T {
  const session = issueSession(agentId);
  const secure = process.env.NODE_ENV === "production";

  response.cookies.set(SESSION_COOKIE, session.value, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAge,
  });
  // Readable by our own JS so it can be echoed back in a header — that is the
  // whole mechanism of the double-submit check in db/auth.ts.
  response.cookies.set(CSRF_COOKIE, newCsrfToken(), {
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAge,
  });
  return response;
}

/** The base URL for links we put in emails. */
export function appOrigin(request: Request): string {
  return process.env.APP_URL ?? new URL(request.url).origin;
}
