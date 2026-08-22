/**
 * The seller's signature step.
 *
 * GET  — where the document is up to, reconciled against DocuSeal.
 * POST — build the document and hand back where to sign it.
 *
 * Authenticated by the seller session cookie, exactly like every other seller
 * route — the magic-link token was spent once at `/s/[token]` and is not in
 * this URL or this body.
 * The DocuSeal API key never leaves this process: what the browser gets is the
 * submitter's own public signing URL, which is scoped to one party on one
 * document and grants nothing else.
 *
 * A seller whose disclosure is already in still gets served here. That is the
 * whole point of the terminal screen — they signed, and they are allowed to
 * come back and look at what they signed.
 */

import { NextResponse } from "next/server";
import { sellerForMutation, sellerForRead } from "@/db/seller-guard";
import {
  refreshSigning,
  signingParties,
  startSigning,
  type SigningStatus,
} from "@/db/signings";

async function payload(dealId: string, sellerName: string, status: SigningStatus) {
  const parties = await signingParties(dealId);
  return {
    state: status.state,
    configured: status.configured,
    // The submitter's public signing URL. Not the API key, and not a URL that
    // reaches any other deal.
    embedSrc: status.signing?.embedSrc ?? null,
    signedAt: status.signedAt?.toISOString() ?? null,
    changeRequestedAt: status.changeRequest?.at.toISOString() ?? null,
    sellerName,
    sellerEmail: parties?.sellerEmail ?? null,
    propertyAddress: parties?.propertyAddress ?? null,
    agentName: parties?.agentName ?? null,
  };
}

export async function GET() {
  // A finished disclosure still gets served: they signed it, and they are
  // allowed to come back and look at what they signed.
  const auth = await sellerForRead();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const session = auth.session;

  // Asks DocuSeal only while a signature is genuinely outstanding, and falls
  // back to what was last known if DocuSeal cannot be reached. This is what
  // makes the terminal screen arrive without a public webhook URL.
  const status = await refreshSigning(session.dealId);
  return NextResponse.json(await payload(session.dealId, session.sellerName, status));
}

export async function POST() {
  const auth = await sellerForMutation({ allowSubmitted: true });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const session = auth.session;

  try {
    // Idempotent: an unfinished document is reused, so a double tap on a bad
    // connection cannot produce two disclosures against one property.
    const signing = await startSigning(session.dealId);
    if (!signing) {
      return NextResponse.json(
        { error: "Couldn't build your form just now." },
        { status: 502 },
      );
    }
  } catch (error) {
    // Never a dead end. The seller keeps their answers and a way to retry;
    // the detail goes to the server log, not to them.
    console.error("docuseal: could not create submission", error);
    return NextResponse.json(
      { error: "Couldn't build your form just now." },
      { status: 502 },
    );
  }

  const status = await refreshSigning(session.dealId);
  return NextResponse.json(await payload(session.dealId, session.sellerName, status));
}
