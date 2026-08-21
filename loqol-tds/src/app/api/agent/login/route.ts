import { NextResponse } from "next/server";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  authenticate,
  issueSession,
  newCsrfToken,
} from "@/db/auth";
import { clearLoginAttempts, recordLoginAttempt } from "@/db/rate-limit";

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }
  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  }

  // Counted before the password is checked, so a wrong guess costs the same as
  // a right one. x-forwarded-for is the platform's; behind no proxy it is
  // absent and everyone shares one bucket, which only tightens the limit.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const limit = recordLoginAttempt(body.email, ip);
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const agent = await authenticate(body.email, body.password);
  if (!agent) {
    // Deliberately identical for unknown email and wrong password.
    return NextResponse.json(
      { error: "That email and password don't match." },
      { status: 401 },
    );
  }

  clearLoginAttempts(body.email);

  const session = issueSession(agent.id);
  const csrf = newCsrfToken();
  const response = NextResponse.json({ ok: true, name: agent.name });
  const secure = process.env.NODE_ENV === "production";

  response.cookies.set(SESSION_COOKIE, session.value, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAge,
  });
  // Readable by our own JS so it can be echoed back in a header.
  response.cookies.set(CSRF_COOKIE, csrf, {
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAge,
  });
  return response;
}
