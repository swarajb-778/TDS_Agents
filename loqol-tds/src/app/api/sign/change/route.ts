/**
 * "I need to change something."
 *
 * The seller has signed and then remembered the water heater. This flags the
 * deal for their agent and nothing else: it does not reopen, edit, void or
 * amend the signed document, because a disclosure signed under penalty is not
 * an editable record. The agent issues a fresh request, which is an action that
 * already exists.
 *
 * The button matters more than it looks. Without it the seller emails their
 * agent at midnight and the problem leaves the product — which means nobody
 * here ever finds out the disclosure is wrong.
 */

import { NextResponse } from "next/server";
import { sellerForMutation } from "@/db/seller-guard";
import { requestChange, signingStatus } from "@/db/signings";

/** Long enough for a real explanation, short enough not to be an inbox. */
const MAX_NOTE = 2000;

export async function POST(request: Request) {
  let body: { note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }
  if (body.note !== undefined && typeof body.note !== "string") {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const auth = await sellerForMutation({ allowSubmitted: true });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const session = auth.session;

  const note = typeof body.note === "string" ? body.note.slice(0, MAX_NOTE) : null;
  const signing = await requestChange(session.dealId, note);
  if (!signing) {
    return NextResponse.json({ error: "Nothing signed yet." }, { status: 409 });
  }

  const status = await signingStatus(session.dealId);
  return NextResponse.json({
    ok: true,
    changeRequestedAt: status.changeRequest?.at.toISOString() ?? null,
  });
}
