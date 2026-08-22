/**
 * The seller's copy of what they signed.
 *
 * Streamed through this app rather than linked: the URL DocuSeal hands back is
 * a short-lived signed link that can expire between rendering a page and the
 * seller tapping it, and it would put a third-party host in front of their own
 * legal document. This way the only URL the browser ever sees is one gated by
 * their own session cookie — and it carries no credential of its own, so the
 * seller can share the page without sharing the disclosure.
 */

import { NextResponse } from "next/server";
import { sellerForRead } from "@/db/seller-guard";
import { executedPdf } from "@/db/signings";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await sellerForRead();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const session = auth.session;

  try {
    const doc = await executedPdf(session.dealId, session.sellerName);
    if (!doc) {
      return NextResponse.json(
        { error: "Your signed copy isn't ready yet. Try again in a moment." },
        { status: 404 },
      );
    }
    return new NextResponse(doc.bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${doc.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("docuseal: could not fetch executed document", error);
    return NextResponse.json(
      { error: "Couldn't fetch your copy just now." },
      { status: 502 },
    );
  }
}
