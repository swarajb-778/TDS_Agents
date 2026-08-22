/**
 * The seller standing by a contradiction, or changing their mind about it.
 *
 * Nothing here blocks anything. Acknowledging only stops the review screen from
 * raising it again; the conflict itself stays visible to the agent.
 */

import { NextResponse } from "next/server";
import { sellerForMutation, sellerForRead } from "@/db/seller-guard";
import { loadAnswers } from "@/db/answers";
import {
  acknowledgeConflict,
  reviewConflicts,
  unacknowledgeConflict,
} from "@/db/conflicts";
import { CONFLICT_RULES } from "@/tds/conflicts";

export async function GET() {
  const auth = await sellerForRead();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const answers = await loadAnswers(auth.session.dealId);
  return NextResponse.json({
    conflicts: await reviewConflicts(auth.session.dealId, answers),
  });
}

export async function POST(request: Request) {
  let body: { ruleId?: unknown; note?: unknown; undo?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  if (typeof body.ruleId !== "string") {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }
  if (!CONFLICT_RULES.some((r) => r.id === body.ruleId)) {
    return NextResponse.json({ error: "Unknown conflict." }, { status: 400 });
  }

  const auth = await sellerForMutation();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const session = auth.session;

  if (body.undo === true) {
    await unacknowledgeConflict(session.dealId, body.ruleId);
  } else {
    await acknowledgeConflict(
      session.dealId,
      body.ruleId,
      { type: "seller", id: session.requestId },
      typeof body.note === "string" ? body.note : undefined,
    );
  }

  const answers = await loadAnswers(session.dealId);
  return NextResponse.json({ ok: true, conflicts: await reviewConflicts(session.dealId, answers) });
}
