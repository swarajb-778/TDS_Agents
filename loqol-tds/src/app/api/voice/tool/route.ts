/**
 * Server-side execution of the voice agent's tool calls.
 *
 * This is where "the model does not own the state machine" is enforced. Every
 * write goes through writeAnswer(), which validates against the registry and
 * rejects low-confidence writes; the response tells the agent what to ask next,
 * derived from flow.ts rather than chosen by the model.
 */

import { NextResponse } from "next/server";
import { sellerForMutation } from "@/db/seller-guard";
import { loadAnswers, writeAnswer, type Actor } from "@/db/answers";
import { nextInChapter, nextQuestion, progress, resolveQuestion } from "@/tds/flow";
import { conflictsFor } from "@/tds/conflicts";
import { canAskAloud } from "@/tds/voice";
import type { AnswerMap, AnswerValue } from "@/tds/types";

interface ToolResult {
  ok: boolean;
  reason?: string;
  recorded?: string;
  /** What to ask next. The agent follows this rather than choosing. */
  next_question_id?: string | null;
  next_prompt?: string | null;
  /** Which chapter that question belongs to, and whether it is a new one. */
  next_chapter?: string | null;
  /**
   * True when there is nothing left here to ask out loud — either the next
   * question is in another chapter, or it is one this chapter keeps on screen
   * (a checkbox grid, a drafted paragraph to read over). Either way the seller
   * is being handed to the screen, so the client shows an explicit way onward
   * rather than trusting the agent to announce it. `next_chapter` names where
   * the next question actually lives, which may still be this one.
   */
  entering_chapter?: boolean;
  /** Surfaced conversationally, never as a correction. */
  note?: string;
  progress?: string;
  done?: boolean;
  /** The client watches for this and swaps to the form. */
  hand_off_to_form?: string;
}

/**
 * What the agent asks next — scoped to the part of the form it is on.
 *
 * The session does not carry a chapter, so it is taken from the question just
 * answered. That matters: asked globally, nextQuestion() returns wherever the
 * seller is in the *whole* form, and for a voice session that is the wrong
 * answer twice over. If an earlier chapter is unfinished it points backwards,
 * so `entering_chapter` fires after a single answer and the client tells a
 * seller who has answered one of sixteen questions that this part is done. And
 * where the next question is a screen job — a sixteen-way checkbox grid, a
 * drafted paragraph to read over — it hands it to the agent to ask out loud.
 *
 * When the part really is over, `next_prompt` comes back null. That is the
 * contract the brief already states: empty prompt plus `entering_chapter` or
 * `done` means stop talking, because there is a button on screen for what
 * comes next and the agent has not been briefed on it.
 */
function whatNext(answers: AnswerMap, currentId?: string): Partial<ToolResult> {
  const current = currentId ? resolveQuestion(currentId) : undefined;
  const q = current
    ? nextInChapter(answers, current.chapter, currentId, canAskAloud)
    : null;

  if (q) {
    return {
      next_question_id: q.id,
      next_prompt: q.voicePrompt ?? q.sellerLabel ?? q.label,
      next_chapter: current!.chapter,
      entering_chapter: false,
      done: false,
    };
  }

  // Nothing left here that can be asked out loud. Where the seller goes next is
  // the screen's decision; the agent only says where they have got to.
  const onward = nextQuestion(answers, currentId);
  if (onward.done || !onward.question) {
    return {
      next_question_id: null,
      next_prompt: null,
      next_chapter: null,
      entering_chapter: false,
      done: true,
    };
  }
  return {
    next_question_id: onward.question.id,
    next_prompt: null,
    next_chapter: onward.chapter,
    entering_chapter: true,
    done: false,
  };
}

/**
 * Execute one tool call for an already-identified seller.
 *
 * Split from the route on purpose. Everything above this line is "which
 * disclosure is this", which needs a request; everything below is "what does
 * this tool do", which does not. Keeping them apart is what lets
 * scripts/voice-check.ts exercise the real contract without a server, a cookie,
 * or a browser.
 */
export async function runVoiceTool(
  session: { dealId: string; requestId: string },
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const body = { name };
  const questionId = typeof args.question_id === "string" ? args.question_id : "";
  const actor: Actor = { type: "seller", id: session.requestId };
  const dealId = session.dealId;

  /*
   * A write needs a real question. Changing input method does not — and must
   * not be refused for want of one. The model sometimes calls switch_to_form
   * with no question_id at all, and a seller who has just said "can I please
   * just tap this" is the last person who should be told the request was
   * invalid and asked again. The id it carries is a bookmark for the form; a
   * missing or stale one costs the seller their place, never the handoff.
   */
  if (body.name !== "switch_to_form" && !resolveQuestion(questionId)) {
    return { ok: false, reason: `Unknown question: ${questionId}` };
  }

  const write = (extra: Parameters<typeof writeAnswer>[0]) => writeAnswer(extra);
  let result: ToolResult;

  switch (body.name) {
    case "record_answer": {
      /*
       * No confidence is not high confidence.
       *
       * validateAnswer() only applies the threshold to a number it is given, so
       * a model that omits the field — or sends "0.4" as a string, which some
       * do — walks an unmeasured answer straight past the one gate that stops a
       * guess, and lands it in the audit trail with a null confidence beside
       * it. On a document signed under penalty that is the wrong default. Ask
       * again instead.
       */
      const confidence =
        typeof args.confidence === "number" && Number.isFinite(args.confidence)
          ? args.confidence
          : undefined;
      if (confidence === undefined) {
        result = {
          ok: false,
          reason: "No confidence given — ask again and say how sure you are.",
          next_question_id: questionId,
        };
        break;
      }
      const outcome = await write({
        dealId,
        questionId,
        value: args.value as AnswerValue,
        source: "voice",
        confidence,
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
      /*
       * An empty explanation is worse than no explanation. It sets the
       * follow-up to "answered", so flow.ts stops asking for it, and the
       * composed box on the PDF prints blank next to a yes the seller signed.
       * The registry's type check passes "" as valid long_text, so it has to be
       * caught here.
       */
      const text = typeof args.text === "string" ? args.text : "";
      if (!text.trim()) {
        result = {
          ok: false,
          reason: "Nothing to write down — ask them to say a little more about it.",
          next_question_id: questionId,
        };
        break;
      }
      const outcome = await write({
        dealId,
        questionId,
        value: text,
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
      // The id is passed on only if it names something real, so the client can
      // fall back to the question the server last handed out rather than
      // sending the form looking for a question that does not exist.
      result = {
        ok: true,
        hand_off_to_form: resolveQuestion(questionId) ? questionId : "",
        recorded: "Handing over to the on-screen version. Say goodbye briefly and stop talking.",
      };
      break;
    }

    default:
      result = { ok: false, reason: `Unknown tool: ${String(body.name)}` };
  }

  return result;
}

export async function POST(request: Request) {
  let body: { name?: unknown; args?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "Malformed request." }, { status: 400 });
  }
  if (typeof body.name !== "string") {
    return NextResponse.json({ ok: false, reason: "Malformed request." }, { status: 400 });
  }

  // The deal is the cookie's, not the model's. Nothing the voice agent can say
  // names a disclosure.
  const auth = await sellerForMutation();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, reason: auth.error }, { status: auth.status });
  }

  const result = await runVoiceTool(
    auth.session,
    body.name,
    (body.args ?? {}) as Record<string, unknown>,
  );
  return NextResponse.json(result);
}
