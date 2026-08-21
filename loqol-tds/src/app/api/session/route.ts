/**
 * Records an explicit modality choice.
 *
 * Only ever called when the seller actually switches path. Persisting on every
 * write would conflate "I chose the form" with "I happened to be in a chapter
 * that only has a form", and quietly opt them out of voice for the sections
 * where it earns its place.
 */

import { NextResponse } from "next/server";
import { resolveSellerToken } from "@/db/requests";
import { savePreferences } from "@/db/sessions";

export async function POST(request: Request) {
  let body: { token?: unknown; modality?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  if (typeof body.token !== "string") {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }
  if (body.modality !== "form" && body.modality !== "voice") {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const session = await resolveSellerToken(body.token);
  if (!session) {
    return NextResponse.json({ error: "This link is no longer valid." }, { status: 401 });
  }

  await savePreferences(session.dealId, { modality: body.modality });
  return NextResponse.json({ ok: true });
}
