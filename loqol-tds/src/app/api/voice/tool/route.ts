/**
 * Server-side execution of the voice agent's tool calls.
 *
 * This is where "the model does not own the state machine" is enforced. Every
 * write goes through writeAnswer(), which validates against the registry and
 * rejects low-confidence writes; the response tells the agent what to ask next,
 * derived from flow.ts rather than chosen by the model.
 */

import { NextResponse } from "next/server";
import { resolveSellerToken } from "@/db/requests";
import { loadAnswers, writeAnswer, type Actor } from "@/db/answers";
import { nextQuestion, progress, resolveQuestion } from "@/tds/flow";
import { conflictsFor } from "@/tds/conflicts";
import type { AnswerMap, AnswerValue } from "@/tds/types";

interface ToolResult {
  ok: boolean;
  reason?: string;
  recorded?: string;
  /** What to ask next. The agent follows this rather than choosing. */
  next_question_id?: string | null;
  next_prompt?: string | null;
  /** Surfaced conversationally, never as a correction. */
  note?: string;
  progress?: string;
  done?: boolean;
  /** The client watches for this and swaps to the form. */
  hand_off_to_form?: string;
}

function whatNext(answers: AnswerMap, currentId?: string): Partial<ToolResult> {
  const next = nextQuestion(answers, currentId);
  if (next.done || !next.question) {
    return { next_question_id: null, next_prompt: null, done: true };
  }
  const q = next.question;
  return {
    next_question_id: q.id,
    next_prompt: q.voicePrompt ?? q.sellerLabel ?? q.label,
    done: false,
  };
}

export async function POST(request: Request) {
  let body: { token?: unknown; name?: unknown; args?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "Malformed request." }, { status: 400 });
  }
  if (typeof body.token !== "string" || typeof body.name !== "string") {
    return NextResponse.json({ ok: false, reason: "Malformed request." }, { status: 400 });
  }

  const session = await resolveSellerToken(body.token);
  if (!session) {
    return NextResponse.json({ ok: false, reason: "This link is no longer valid." }, { status: 401 });
  }

  const args = (body.args ?? {}) as Record<string, unknown>;
  const questionId = typeof args.question_id === "string" ? args.question_id : "";
  const actor: Actor = { type: "seller", id: session.requestId };
  const dealId = session.dealId;

  if (!resolveQuestion(questionId)) {
    return NextResponse.json({ ok: false, reason: `Unknown question: ${questionId}` });
  }

  const write = (extra: Parameters<typeof writeAnswer>[0]) => writeAnswer(extra);
  let result: ToolResult;

  switch (body.name) {
    case "record_answer": {
      const outcome = await write({
        dealId,
        questionId,
        value: args.value as AnswerValue,
        source: "voice",
        confidence: typeof args.confidence === "number" ? args.confidence : undefined,
        verbatim: typeof args.verbatim === "string" ? args.verbatim : undefined,
        actor,
      });
      if (!outcome.ok) {
        // Rejected, not thrown: the agent re-asks rather than guessing.
        result = { ok: false, reason: outcome.reason, next_question_id: questionId };
        break;
      }
      const answers = await loadAnswers(dealId);
      const clash = conflictsFor(questionId, answers)[0];
      result = {
        ok: true,
        recorded: `${questionId} = ${JSON.stringify(args.value)}`,
        ...whatNext(answers, questionId),
        // A conflict is raised as a question, never as a correction.
        ...(clash ? { note: clash.message } : {}),
        progress: progress(answers).label,
      };
      break;
    }

    case "record_explanation": {
      const outcome = await write({
        dealId,
        questionId,
        value: typeof args.text === "string" ? args.text : "",
        source: "voice",
        verbatim: typeof args.verbatim === "string" ? args.verbatim : undefined,
        actor,
      });
      if (!outcome.ok) {
        result = { ok: false, reason: outcome.reason, next_question_id: questionId };
        break;
      }
      const answers = await loadAnswers(dealId);
      result = { ok: true, recorded: `${questionId} explained`, ...whatNext(answers, questionId) };
      break;
    }

    case "mark_unknown":
    case "flag_for_agent": {
      const isUnknown = body.name === "mark_unknown";
      const outcome = await write({
        dealId,
        questionId,
        value: null,
        status: isUnknown ? "unknown" : "flagged_for_agent",
        source: "voice",
        note: typeof (args.reason ?? args.note) === "string" ? String(args.reason ?? args.note) : undefined,
        actor,
      });
      if (!outcome.ok) {
        result = { ok: false, reason: outcome.reason, next_question_id: questionId };
        break;
      }
      const answers = await loadAnswers(dealId);
      result = {
        ok: true,
        recorded: isUnknown
          ? `${questionId} — seller doesn't know; routed to their agent`
          : `${questionId} — flagged for their agent`,
        ...whatNext(answers, questionId),
      };
      break;
    }

    case "switch_to_form": {
      // Nothing is written. The seller changed input method, not their mind.
      result = {
        ok: true,
        hand_off_to_form: questionId,
        recorded: "Handing over to the on-screen version. Say goodbye briefly and stop talking.",
      };
      break;
    }

    default:
      result = { ok: false, reason: `Unknown tool: ${String(body.name)}` };
  }

  return NextResponse.json(result);
}
