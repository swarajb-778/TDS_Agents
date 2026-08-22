/**
 * The seller's write endpoint. Both modalities land here.
 *
 * Authenticated by the seller session cookie — the magic-link token was spent
 * once at `/s/[token]` and never travels again, so it is not in this URL, this
 * body, or any access log. Clients may still send a `token` field; it is
 * ignored, and deliberately so: an inert field cannot become a second, weaker
 * way in.
 */

import { NextResponse } from "next/server";
import { sellerForMutation, sellerForRead } from "@/db/seller-guard";
import { loadAnswers, writeAnswer } from "@/db/answers";
import { loadPreferences } from "@/db/sessions";
import type { AnswerStatus, AnswerValue, Modality } from "@/tds/types";

const STATUSES: AnswerStatus[] = [
  "unanswered",
  "answered",
  "unknown",
  "skipped",
  "flagged_for_agent",
];
const SOURCES: Modality[] = ["form", "voice", "agent", "none"];

interface IncomingAnswer {
  questionId: string;
  value: AnswerValue;
  status?: AnswerStatus;
  source?: Modality;
  confidence?: number;
  verbatim?: string;
  note?: string;
}

/**
 * Shape check only. The authoritative validation is validateAnswer(), which
 * checks the value against that question's type in the registry — something no
 * generic schema can express, since the expected type differs per question id.
 */
function parseBody(body: unknown): { answers: IncomingAnswer[] } | null {
  if (typeof body !== "object" || body === null) return null;
  const { answers } = body as Record<string, unknown>;

  if (!Array.isArray(answers) || answers.length === 0 || answers.length > 100) {
    return null;
  }

  const parsed: IncomingAnswer[] = [];
  for (const entry of answers) {
    if (typeof entry !== "object" || entry === null) return null;
    const a = entry as Record<string, unknown>;

    if (typeof a.questionId !== "string" || !a.questionId) return null;
    if (a.status !== undefined && !STATUSES.includes(a.status as AnswerStatus)) return null;
    if (a.source !== undefined && !SOURCES.includes(a.source as Modality)) return null;
    if (a.confidence !== undefined && typeof a.confidence !== "number") return null;
    if (a.verbatim !== undefined && typeof a.verbatim !== "string") return null;
    if (a.note !== undefined && typeof a.note !== "string") return null;

    parsed.push({
      questionId: a.questionId,
      value: (a.value ?? null) as AnswerValue,
      status: a.status as AnswerStatus | undefined,
      source: a.source as Modality | undefined,
      confidence: a.confidence as number | undefined,
      verbatim: a.verbatim as string | undefined,
      note: a.note as string | undefined,
    });
  }
  return { answers: parsed };
}

/**
 * The current answer set. Both input paths read this, which is what makes
 * switching between them free — there is one store and nothing to sync.
 */
export async function GET() {
  const auth = await sellerForRead();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const [answers, preferences] = await Promise.all([
    loadAnswers(auth.session.dealId),
    loadPreferences(auth.session.dealId),
  ]);
  return NextResponse.json({ answers, modality: preferences.modality });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const parsed = parseBody(body);
  if (!parsed) {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  // Unknown, revoked, expired or already submitted. The seller is told which
  // on the help page, and every one of those has a way forward from there.
  const auth = await sellerForMutation();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const session = auth.session;

  // A rejected answer is never fatal. We report which ones didn't take and let
  // the seller keep going — an abandoned session is worse than a gap.
  const rejected: Array<{ questionId: string; reason: string }> = [];
  for (const answer of parsed.answers) {
    const result = await writeAnswer({
      dealId: session.dealId,
      questionId: answer.questionId,
      value: answer.value,
      status: answer.status,
      source: answer.source ?? "form",
      confidence: answer.confidence,
      verbatim: answer.verbatim,
      note: answer.note,
      actor: { type: "seller", id: session.requestId },
    });
    if (!result.ok) rejected.push({ questionId: answer.questionId, reason: result.reason });
  }

  return NextResponse.json({
    ok: true,
    written: parsed.answers.length - rejected.length,
    rejected,
    answers: await loadAnswers(session.dealId),
  });
}
