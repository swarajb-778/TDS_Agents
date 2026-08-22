/**
 * The agent's copy of the executed disclosure.
 *
 * Scoped by agent, like every other agent route: `dealForAgent` refuses a deal
 * that is not theirs before anything reaches DocuSeal. A GET, so it can be a
 * plain link on the deal page — nothing here mutates.
 */

import { NextResponse } from "next/server";
import { currentAgent } from "@/db/guard";
import { dealForAgent } from "@/db/deals";
import { executedPdf } from "@/db/signings";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const agent = await currentAgent();
  if (!agent) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const { id } = await params;
  const deal = await dealForAgent(id, agent.id);
  if (!deal) return NextResponse.json({ error: "Not found." }, { status: 404 });

  try {
    const doc = await executedPdf(deal.id, deal.sellerName);
    if (!doc) {
      return NextResponse.json({ error: "No executed document yet." }, { status: 404 });
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
    return NextResponse.json({ error: "DocuSeal is unreachable." }, { status: 502 });
  }
}
