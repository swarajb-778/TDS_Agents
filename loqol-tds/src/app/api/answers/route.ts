/**
 * The seller's write endpoint. Both modalities will land here; the form path
 * uses it now, the voice path's tool calls will use it in task 4.
 *
 * Authenticated by the magic-link token, sent in the body rather than the URL
 * so it does not end up in access logs.
 */

import { NextResponse } from "next/server";
import { resolveSellerToken } from "@/db/requests";
import { writeAnswer } from "@/db/answers";
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
function parseBody(body: unknown): { token: string; answers: IncomingAnswer[] } | null {
  if (typeof body !== "object" || body === null) return null;
  const { token, answers } = body as Record<string, unknown>;

  if (typeof token !== "string" || !token) return null;
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
  return { token, answers: parsed };
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

  const session = await resolveSellerToken(parsed.token);
  if (!session) {
    // Unknown, revoked, or expired. The agent can reissue the link.
    return NextResponse.json({ error: "This link is no longer valid." }, { status: 401 });
  }

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

  return NextResponse.json({ ok: true, written: parsed.answers.length - rejected.length, rejected });
}
