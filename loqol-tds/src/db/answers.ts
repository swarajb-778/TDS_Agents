/**
 * The answer repository — the only bridge between the database and the pure
 * flow engine in src/tds/.
 *
 * Both modalities write through `writeAnswer()`. There is nothing to sync
 * between voice and form because there is only one store.
 */

import { and, eq } from "drizzle-orm";
import { db } from "./index";
import { answerEvents, answers as answersTable, type ActorType } from "./schema";
import { resolveQuestion, validateAnswer } from "../tds/flow";
import type {
  Answer,
  AnswerMap,
  AnswerStatus,
  AnswerValue,
  Modality,
} from "../tds/types";

/** Who caused the write. `source` covers "from where"; this covers "who". */
export interface Actor {
  type: ActorType;
  /** Agent uuid, disclosure-request uuid, or a system identifier. */
  id: string;
}

export interface WriteAnswerInput {
  dealId: string;
  questionId: string;
  value: AnswerValue;
  /** Defaults to "answered". The other statuses skip type validation. */
  status?: AnswerStatus;
  source: Modality;
  confidence?: number;
  verbatim?: string;
  note?: string;
  actor: Actor;
}

export type WriteResult =
  | { ok: true; answer: Answer }
  | { ok: false; reason: string };

/**
 * The whole answer set for a deal, in the shape the flow engine consumes.
 *
 * Feeds nextQuestion(), progress(), resume(), detectConflicts() and
 * toFieldValues() unchanged.
 */
export async function loadAnswers(dealId: string): Promise<AnswerMap> {
  const rows = await db
    .select()
    .from(answersTable)
    .where(eq(answersTable.dealId, dealId));

  const map: AnswerMap = {};
  for (const row of rows) {
    map[row.questionId] = {
      questionId: row.questionId,
      value: row.value ?? null,
      status: row.status,
      source: row.source,
      // null is a database concept; the Answer type uses optional fields, and
      // toFieldValues() checks for undefined.
      confidence: row.confidence ?? undefined,
      verbatim: row.verbatim ?? undefined,
      note: row.note ?? undefined,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  return map;
}

/**
 * Single write path for every answer, from either modality.
 *
 * "unknown", "skipped" and "flagged_for_agent" are this same call with a
 * different status — they are answers, not failures, and they get audit rows
 * like anything else.
 *
 * Returns a reason instead of throwing: a low-confidence voice write has to
 * come back as "re-ask", not as a 500.
 */
export async function writeAnswer(input: WriteAnswerInput): Promise<WriteResult> {
  const status: AnswerStatus = input.status ?? "answered";

  // resolveQuestion, not getQuestion — follow-ups like C.13.explanation are
  // synthesised and absent from QUESTIONS.
  if (!resolveQuestion(input.questionId)) {
    return { ok: false, reason: `Unknown question: ${input.questionId}` };
  }

  // Type and confidence checks apply only to a committed answer. The other
  // statuses carry a null value that validateAnswer() would reject — it type
  // checks against the registry, and "I don't know" has no type. This is the
  // one place the two layers could silently disagree; db-check.ts covers it.
  if (status === "answered") {
    const check = validateAnswer(input.questionId, input.value, input.confidence);
    if (!check.ok) return { ok: false, reason: check.reason };
  }

  const now = new Date();
  const row = {
    dealId: input.dealId,
    questionId: input.questionId,
    value: input.value,
    status,
    source: input.source,
    confidence: input.confidence ?? null,
    verbatim: input.verbatim ?? null,
    note: input.note ?? null,
  };

  // The audit row and the state change land together or not at all.
  await db.transaction(async (tx) => {
    await tx
      .insert(answersTable)
      .values({ ...row, updatedAt: now })
      .onConflictDoUpdate({
        target: [answersTable.dealId, answersTable.questionId],
        set: { ...row, updatedAt: now },
      });

    await tx.insert(answerEvents).values({
      ...row,
      actorType: input.actor.type,
      actorId: input.actor.id,
      createdAt: now,
    });
  });

  return {
    ok: true,
    answer: {
      questionId: input.questionId,
      value: input.value,
      status,
      source: input.source,
      confidence: input.confidence,
      verbatim: input.verbatim,
      note: input.note,
      updatedAt: now.toISOString(),
    },
  };
}

/** Full history for one question — the agent view's "how did we get here". */
export async function answerHistory(dealId: string, questionId: string) {
  return db
    .select()
    .from(answerEvents)
    .where(
      and(eq(answerEvents.dealId, dealId), eq(answerEvents.questionId, questionId)),
    )
    .orderBy(answerEvents.createdAt);
}
