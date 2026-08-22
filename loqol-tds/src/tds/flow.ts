/**
 * FLOW — everything about *where the seller is* is derived here.
 *
 * Deliberately not an LLM's job. The model handles language; the server owns
 * the queue. On a legal disclosure, question sequencing has to be deterministic
 * and replayable, and "the model decided to skip C.9" is not an acceptable
 * audit trail entry.
 */

import type {
  Answer,
  AnswerMap,
  AnswerValue,
  ChapterId,
  Modality,
  Question,
} from "./types";
import {
  CHAPTER_ORDER,
  QUESTIONS,
  getChapter,
  getQuestion,
  questionsInChapter,
} from "./registry";

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

export function isVisible(q: Question, answers: AnswerMap): boolean {
  if (!q.gatedBy) return true;
  const gate = q.gatedBy;
  const parent = answers[gate.questionId];
  if (!parent || parent.status === "unanswered") return false;

  if (gate.isTruthy !== undefined) {
    return Boolean(parent.value) === gate.isTruthy;
  }
  if (gate.includes !== undefined) {
    return Array.isArray(parent.value) && parent.value.includes(gate.includes);
  }
  if (gate.equals !== undefined) {
    return parent.value === gate.equals;
  }
  return true;
}

/** Every question currently in play, in flow order. */
export function visibleQuestions(answers: AnswerMap): Question[] {
  const ordered = CHAPTER_ORDER.flatMap((c) => questionsInChapter(c));
  return ordered.filter(
    (q) => q.defaultModality !== "agent" && isVisible(q, answers),
  );
}

// ---------------------------------------------------------------------------
// Follow-ups
//
// A `yes` on C.7 is not an answer, it's half of one. We synthesise a follow-up
// question the moment the trigger fires and store it under its own id, then
// compose the shared PDF box at render time. Asking a seller to explain sixteen
// yeses in one box at the end produces mush and they've forgotten which was
// which.
// ---------------------------------------------------------------------------

export function followUpId(parentId: string): string {
  return `${parentId}.explanation`;
}

export function synthesiseFollowUp(parent: Question): Question | null {
  if (!parent.followUp) return null;
  return {
    id: followUpId(parent.id),
    chapter: parent.chapter,
    group: parent.group,
    label: `Explanation for ${parent.id}`,
    sellerLabel: parent.followUp.prompt,
    voicePrompt: parent.followUp.voicePrompt ?? parent.followUp.prompt,
    type: "long_text",
    defaultModality: parent.defaultModality,
    allowUnknown: false,
    required: parent.followUp.required,
    gatedBy: { questionId: parent.id, equals: parent.followUp.when },
    docuseal: { kind: "none" }, // composed into the shared box, never printed alone
    estimatedSeconds: 30,
  };
}

/**
 * Look up a question by id, including follow-ups.
 *
 * Follow-ups are synthesised rather than stored, so `getQuestion("C.13.explanation")`
 * is undefined. Anything that accepts a question id from the outside — a voice
 * tool call, a form POST, an answer row — has to go through here, or writing an
 * explanation fails as "unknown question".
 */
export function resolveQuestion(id: string): Question | undefined {
  const direct = getQuestion(id);
  if (direct) return direct;

  const suffix = ".explanation";
  if (!id.endsWith(suffix)) return undefined;

  const parent = getQuestion(id.slice(0, -suffix.length));
  return parent ? (synthesiseFollowUp(parent) ?? undefined) : undefined;
}

function followUpDue(parent: Question, answers: AnswerMap): boolean {
  if (!parent.followUp) return false;
  const a = answers[parent.id];
  if (!a || a.status !== "answered") return false;
  const triggered = Array.isArray(parent.followUp.when)
    ? false
    : a.value === parent.followUp.when;
  if (!triggered) return false;
  const fu = answers[followUpId(parent.id)];
  return !fu || fu.status === "unanswered";
}

// ---------------------------------------------------------------------------
// Next question
// ---------------------------------------------------------------------------

export interface NextResult {
  question: Question | null;
  chapter: ChapterId | null;
  /** True when a chapter boundary was just crossed — show the chapter intro. */
  enteringChapter: boolean;
  done: boolean;
}

/**
 * The seller's position is a function of the answer set, not a cursor. That's
 * what makes closing the tab safe and makes modality handoff free — voice and
 * form ask this same function and get the same answer.
 */
export function nextQuestion(
  answers: AnswerMap,
  currentId?: string,
): NextResult {
  const queue = visibleQuestions(answers);
  const current = currentId ? resolveQuestion(currentId) : undefined;
  const currentChapter = current?.chapter ?? null;

  // A follow-up on the question just answered comes next, always. Capture the
  // narrative while the seller still has the thing in their head — asking for
  // it later means they've moved on and the detail is gone.
  if (current && followUpDue(current, answers)) {
    return {
      question: synthesiseFollowUp(current)!,
      chapter: current.chapter,
      enteringChapter: false,
      done: false,
    };
  }

  for (const q of queue) {
    // Any other outstanding follow-up still jumps ahead of new questions.
    if (followUpDue(q, answers)) {
      const fu = synthesiseFollowUp(q)!;
      return {
        question: fu,
        chapter: q.chapter,
        enteringChapter: q.chapter !== currentChapter,
        done: false,
      };
    }
    const a = answers[q.id];
    if (!a || a.status === "unanswered") {
      return {
        question: q,
        chapter: q.chapter,
        enteringChapter: q.chapter !== currentChapter,
        done: false,
      };
    }
  }

  // Only now, with nothing new left, do the deferred ones come round again.
  // Returning a skipped question immediately would make "come back to it" a
  // lie — the seller taps it and is handed the same question straight back.
  for (const q of queue) {
    if (answers[q.id]?.status === "skipped") {
      return {
        question: q,
        chapter: q.chapter,
        enteringChapter: q.chapter !== currentChapter,
        done: false,
      };
    }
  }

  return { question: null, chapter: null, enteringChapter: false, done: true };
}

/**
 * The next question *inside one chapter*, optionally narrowed further.
 *
 * nextQuestion() answers "where is the seller in the whole form". A voice
 * session answers a smaller question: it covers one part, it is briefed on
 * that part only, and it must not be handed anything else. Those are not the
 * same query, and using the global one for a voice session goes wrong two
 * ways: with an earlier chapter unfinished it points backwards, so the part
 * ends after a single answer; and with a form-only question next it asks a
 * sixteen-way checkbox grid out loud.
 *
 * `accept` is how a caller says what it can actually ask. A rejected question
 * is stepped over, never blocked on — the global queue still has it, and the
 * seller reaches it on the path that suits it.
 *
 * Returns null when this chapter has nothing left for this caller.
 */
export function nextInChapter(
  answers: AnswerMap,
  chapter: ChapterId,
  currentId?: string,
  accept: (q: Question) => boolean = () => true,
): Question | null {
  const current = currentId ? resolveQuestion(currentId) : undefined;

  // Same rule as nextQuestion: the follow-up to what was just answered comes
  // first, while the seller still has the thing in their head.
  if (current && current.chapter === chapter && followUpDue(current, answers)) {
    const fu = synthesiseFollowUp(current)!;
    if (accept(fu)) return fu;
  }

  const queue = visibleQuestions(answers).filter((q) => q.chapter === chapter);

  for (const q of queue) {
    if (followUpDue(q, answers)) {
      const fu = synthesiseFollowUp(q)!;
      if (accept(fu)) return fu;
    }
    const a = answers[q.id];
    if ((!a || a.status === "unanswered") && accept(q)) return q;
  }

  for (const q of queue) {
    if (answers[q.id]?.status === "skipped" && accept(q)) return q;
  }

  return null;
}

/**
 * Skipped questions come back at the end rather than blocking. "Come back to it"
 * has to actually mean something or sellers stop trusting the button.
 */
export function deferredQuestions(answers: AnswerMap): Question[] {
  return visibleQuestions(answers).filter(
    (q) => answers[q.id]?.status === "skipped",
  );
}

/**
 * True when nothing new is left and the seller is being shown things they set
 * aside earlier.
 *
 * Matters because deferral must not become a trap: a seller who skips the last
 * outstanding question would otherwise be handed it again forever. In this
 * state the UI offers a way out — leave the rest for the agent — instead of
 * looping. Nothing blocks, including the thing built to un-block.
 */
export function inDeferralPass(answers: AnswerMap): boolean {
  const next = nextQuestion(answers);
  return (
    !next.done &&
    !!next.question &&
    answers[next.question.id]?.status === "skipped"
  );
}

/** Everything the agent needs to chase — the "I don't know" queue. */
export function agentQueue(answers: AnswerMap): Question[] {
  const chase = (id: string) => {
    const s = answers[id]?.status;
    return s === "unknown" || s === "flagged_for_agent";
  };
  const out: Question[] = [];
  for (const q of visibleQuestions(answers)) {
    if (chase(q.id)) out.push(q);
    // An explanation the seller could not give is exactly the thing the agent
    // has to chase: the yes is on the form and the box under it is empty.
    // Follow-ups are synthesised, so filtering QUESTIONS alone loses them
    // silently — the seller is told it goes to their agent and it does not.
    const fu = synthesiseFollowUp(q);
    if (fu && isVisible(fu, answers) && chase(fu.id)) out.push(fu);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Progress
//
// Not "field 87 of 150". A seller with no defects has a genuinely shorter form
// than one with defects, so a raw field count lies. Chapters plus an adaptive
// time estimate tell the truth.
// ---------------------------------------------------------------------------

export interface ChapterProgress {
  chapter: ChapterId;
  title: string;
  total: number;
  answered: number;
  state: "not_started" | "in_progress" | "complete";
  secondsRemaining: number;
}

export interface Progress {
  chapters: ChapterProgress[];
  overallPercent: number;
  secondsRemaining: number;
  /** Seller-facing. "About 6 minutes left" beats "42% complete". */
  label: string;
}

export function progress(answers: AnswerMap): Progress {
  const chapters: ChapterProgress[] = [];

  for (const id of CHAPTER_ORDER) {
    if (id === "confirm" || id === "sign") continue;
    const qs = questionsInChapter(id).filter(
      (q) => q.defaultModality !== "agent" && isVisible(q, answers),
    );
    if (qs.length === 0) continue;

    const answered = qs.filter((q) => {
      const s = answers[q.id]?.status;
      return s === "answered" || s === "unknown" || s === "flagged_for_agent";
    }).length;

    const remaining = qs
      .filter((q) => {
        const s = answers[q.id]?.status;
        return !s || s === "unanswered" || s === "skipped";
      })
      .reduce((sum, q) => sum + q.estimatedSeconds, 0);

    chapters.push({
      chapter: id,
      title: getChapter(id)?.title ?? id,
      total: qs.length,
      answered,
      state:
        answered === 0
          ? "not_started"
          : answered === qs.length
            ? "complete"
            : "in_progress",
      secondsRemaining: remaining,
    });
  }

  const total = chapters.reduce((s, c) => s + c.total, 0);
  const done = chapters.reduce((s, c) => s + c.answered, 0);
  const secondsRemaining = chapters.reduce((s, c) => s + c.secondsRemaining, 0);

  return {
    chapters,
    overallPercent: total === 0 ? 0 : Math.round((done / total) * 100),
    secondsRemaining,
    label: humanTime(secondsRemaining),
  };
}

function humanTime(seconds: number): string {
  if (seconds <= 0) return "Almost done";
  if (seconds < 90) return "Under a minute left";
  const mins = Math.round(seconds / 60);
  return `About ${mins} minute${mins === 1 ? "" : "s"} left`;
}

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

export interface ResumeState {
  question: Question | null;
  chapterTitle: string | null;
  /** Copy for the welcome-back screen. Names the place, offers a way out. */
  message: string;
  modality: Modality;
}

export function resume(
  answers: AnswerMap,
  lastModality: Modality = "form",
): ResumeState {
  const p = progress(answers);
  const next = nextQuestion(answers);

  if (next.done) {
    return {
      question: null,
      chapterTitle: null,
      message: "You're all done — ready to review and sign.",
      modality: lastModality,
    };
  }

  const title = next.chapter ? (getChapter(next.chapter)?.title ?? null) : null;

  if (p.overallPercent === 0) {
    return {
      question: next.question,
      chapterTitle: title,
      message: "Let's get started. Most people finish in about fifteen minutes.",
      modality: lastModality,
    };
  }

  return {
    question: next.question,
    chapterTitle: title,
    message: `Welcome back — you were on "${title}". ${p.label}. Pick up there, or review what you've done so far.`,
    modality: lastModality,
  };
}

// ---------------------------------------------------------------------------
// Voice tool schemas
//
// The model never free-forms state. It calls these; the server validates every
// write against the registry and returns the next question. Low confidence
// means the write is rejected and the agent re-asks rather than guessing.
// ---------------------------------------------------------------------------

export const CONFIDENCE_THRESHOLD = 0.75;

export function voiceToolSchemas() {
  return [
    {
      name: "record_answer",
      description:
        "Record the seller's answer to the current question. Only call this when the seller has clearly committed to an answer. If they're hedging, ask a clarifying question instead.",
      parameters: {
        type: "object",
        properties: {
          question_id: { type: "string" },
          value: {
            description:
              "boolean for yes/no, string for enum/text, array of strings for multi-select, number for numeric",
          },
          confidence: {
            type: "number",
            description: "0-1. Below 0.75 the write is rejected and you re-ask.",
          },
          verbatim: {
            type: "string",
            description:
              "What the seller actually said, near enough. Kept for the agent's review and the audit trail.",
          },
        },
        required: ["question_id", "value", "confidence", "verbatim"],
      },
    },
    {
      name: "record_explanation",
      description:
        "Capture the narrative for a question the seller answered yes to. Write it in the seller's own words, cleaned up lightly. Do not add facts they did not state.",
      parameters: {
        type: "object",
        properties: {
          question_id: { type: "string" },
          text: { type: "string" },
          verbatim: { type: "string" },
        },
        required: ["question_id", "text"],
      },
    },
    {
      name: "mark_unknown",
      description:
        "The seller does not know. Before calling this, check whether they mean 'no, not aware of any' — on a TDS those are different answers and sellers routinely conflate them. If they truly don't know, this routes to their agent.",
      parameters: {
        type: "object",
        properties: {
          question_id: { type: "string" },
          reason: { type: "string" },
        },
        required: ["question_id"],
      },
    },
    {
      name: "flag_for_agent",
      description:
        "The seller wants a human to look at this. Never use this to avoid explaining something — explain first, flag only if they still want it.",
      parameters: {
        type: "object",
        properties: {
          question_id: { type: "string" },
          note: { type: "string" },
        },
        required: ["question_id"],
      },
    },
    {
      name: "switch_to_form",
      description:
        "The seller would rather tap than talk for this question. Hand off immediately and without friction — do not talk them out of it.",
      parameters: {
        type: "object",
        properties: { question_id: { type: "string" } },
        required: ["question_id"],
      },
    },
  ];
}

/**
 * Server-side validation of a voice write. Everything the model sends passes
 * through here before it touches the answer store.
 */
export function validateAnswer(
  questionId: string,
  value: AnswerValue,
  confidence?: number,
): { ok: true } | { ok: false; reason: string } {
  const q = resolveQuestion(questionId);
  if (!q) return { ok: false, reason: `Unknown question: ${questionId}` };

  if (confidence !== undefined && confidence < CONFIDENCE_THRESHOLD) {
    return { ok: false, reason: "Low confidence — ask again." };
  }

  switch (q.type) {
    case "boolean":
      if (typeof value !== "boolean")
        return { ok: false, reason: "Expected true or false." };
      break;
    case "number":
      if (typeof value !== "number")
        return { ok: false, reason: "Expected a number." };
      break;
    case "enum": {
      const valid = q.options?.map((o) => o.value) ?? [];
      if (typeof value !== "string" || !valid.includes(value))
        return { ok: false, reason: `Expected one of: ${valid.join(", ")}` };
      break;
    }
    case "multi_enum": {
      const valid = q.options?.map((o) => o.value) ?? [];
      if (!Array.isArray(value) || value.some((v) => !valid.includes(v)))
        return { ok: false, reason: `Expected a subset of: ${valid.join(", ")}` };
      break;
    }
    case "text":
    case "long_text":
    case "date":
      if (typeof value !== "string")
        return { ok: false, reason: "Expected text." };
      break;
    case "acknowledgement":
      break;
  }

  return { ok: true };
}

export function makeAnswer(
  questionId: string,
  value: AnswerValue,
  source: Modality,
  extra: Partial<Answer> = {},
): Answer {
  return {
    questionId,
    value,
    status: "answered",
    source,
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

/** Sanity check — run in CI so a bad gate reference can't ship. */
export function validateRegistry(): string[] {
  const errors: string[] = [];
  const ids = new Set(QUESTIONS.map((q) => q.id));

  for (const q of QUESTIONS) {
    if (q.gatedBy && !ids.has(q.gatedBy.questionId)) {
      errors.push(`${q.id}: gate references unknown question ${q.gatedBy.questionId}`);
    }
    if (q.followUp && !ids.has(q.followUp.into)) {
      errors.push(`${q.id}: followUp targets unknown field ${q.followUp.into}`);
    }
    if ((q.type === "enum" || q.type === "multi_enum") && !q.options?.length) {
      errors.push(`${q.id}: enum without options`);
    }
    if (q.defaultModality === "voice" && !q.voicePrompt) {
      errors.push(`${q.id}: voice-first question with no voicePrompt`);
    }
  }

  const seen = new Set<string>();
  for (const q of QUESTIONS) {
    if (seen.has(q.id)) errors.push(`Duplicate question id: ${q.id}`);
    seen.add(q.id);
  }

  return errors;
}
