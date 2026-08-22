/**
 * Records an explicit modality choice.
 *
 * Only ever called when the seller actually switches path. Persisting on every
 * write would conflate "I chose the form" with "I happened to be in a chapter
 * that only has a form", and quietly opt them out of voice for the sections
 * where it earns its place.
 */

import { NextResponse } from "next/server";
import { sellerForMutation } from "@/db/seller-guard";
import { savePreferences } from "@/db/sessions";

export async function POST(request: Request) {
  let body: { modality?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  if (body.modality !== "form" && body.modality !== "voice") {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  // The deal comes from the session cookie, never from the body. There is no
  // parameter here that could name someone else's disclosure.
  const auth = await sellerForMutation();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  await savePreferences(auth.session.dealId, { modality: body.modality });
  return NextResponse.json({ ok: true });
}
