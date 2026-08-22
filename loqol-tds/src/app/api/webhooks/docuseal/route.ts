/**
 * DocuSeal -> here, when a party finishes signing.
 *
 * Unauthenticated by URL and authenticated by secret: see docuseal-webhook.ts
 * for which mechanisms DocuSeal offers and why this fails closed without one.
 * Nothing in the body is trusted for identity — the submission id is looked up
 * against a row this app created, and the submitter id must match the seller it
 * recorded, so a caller who guesses a submission number still cannot mark a
 * disclosure signed on someone else's behalf.
 *
 * Status codes are chosen for DocuSeal's retry behaviour: 4xx and 5xx are
 * retried for 48 hours, 2xx is not. An event about a submission this app has
 * never heard of will never become interesting, so it gets a 200 and a note
 * rather than two days of pointless retries.
 */

import { NextResponse } from "next/server";
import { recordCompletion, latestSigning } from "@/db/signings";
import { db } from "@/db/index";
import { signings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { parseFormCompleted, verifyWebhook } from "@/tds/docuseal-webhook";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // The raw bytes, before any parsing: the HMAC covers exactly what was sent,
  // and a re-serialised object will not match even when it is the same JSON.
  const raw = await request.text();

  const verdict = verifyWebhook(request.headers, raw);
  if (!verdict.ok) {
    // Deliberately terse. A forger learns nothing about which check failed.
    return NextResponse.json({ error: "Rejected." }, { status: verdict.status });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const event = parseFormCompleted(body);
  // Every other event type is fine, just not acted on. Saying so beats a 400
  // that DocuSeal would retry for two days.
  if (!event) return NextResponse.json({ ok: true, ignored: "not form.completed" });

  const [row] = await db
    .select()
    .from(signings)
    .where(eq(signings.submissionId, event.submissionId))
    .limit(1);
  if (!row) {
    return NextResponse.json({ ok: true, ignored: "unknown submission" });
  }

  // `form.completed` fires for every party. The listing agent countersigning is
  // a real event and not the seller submitting their disclosure, so only the
  // submitter this app recorded as Seller 1 moves `deals.submitted_at`.
  if (event.submitterId !== row.submitterId) {
    return NextResponse.json({ ok: true, ignored: `role: ${event.role || "other"}` });
  }

  await recordCompletion(event.submissionId, event.completedAt);
  const signing = await latestSigning(row.dealId);

  return NextResponse.json({ ok: true, signedAt: signing?.completedAt ?? null });
}
