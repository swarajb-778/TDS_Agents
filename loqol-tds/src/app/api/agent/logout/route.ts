import { NextResponse } from "next/server";
import { CSRF_COOKIE, SESSION_COOKIE } from "@/db/auth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete(CSRF_COOKIE);
  return response;
}
