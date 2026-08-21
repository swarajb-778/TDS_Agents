/**
 * How the registry projects into the form UI. Pure, no React — so it can be
 * asserted in a script rather than only exercised by clicking.
 */

import { groupsInChapter, questionsInChapter } from "./registry";
import { isVisible, resolveQuestion } from "./flow";
import type { AnswerMap, ChapterId, Question } from "./types";

/**
 * The registry writes inventory items as nouns ("Dishwasher") and genuine
 * questions with a question mark ("Is there a child-resistant barrier?").
 *
 * Nouns become tap-to-add chips: forty of them is ninety seconds. Questions get
 * an explicit Yes/No, because "tap if you have a child-resistant barrier" is
 * not something anyone should be signing under penalty of perjury.
 */
export function isPresenceChip(q: Question): boolean {
  return (
    q.type === "boolean" && !(q.sellerLabel ?? q.label).trim().endsWith("?")
  );
}

export function questionsInGroup(chapter: ChapterId, group: string): Question[] {
  return questionsInChapter(chapter).filter((q) => q.group === group);
}

const isOpen = (q: Question, answers: AnswerMap) =>
  isVisible(q, answers) && !answers[q.id];

/**
 * Position is derived, not stored — the same rule the flow engine follows.
 * Closing the tab and coming back lands the seller where they still have work.
 *
 * Chips are checked first because they are the spine of the chapter. An open
 * follow-up does not drag a seller backwards mid-chapter — they were told they
 * could come back to it — but it does get collected before the chapter ends.
 * The second pass is also what catches a group made entirely of follow-ups,
 * like Roof, which has no chips and would otherwise never be reached.
 */
export function firstIncompleteGroup(
  chapter: ChapterId,
  answers: AnswerMap,
): number {
  const groups = groupsInChapter(chapter);

  const byChip = groups.findIndex((g) =>
    questionsInGroup(chapter, g)
      .filter(isPresenceChip)
      .some((q) => isOpen(q, answers)),
  );
  if (byChip !== -1) return byChip;

  const byFollowUp = groups.findIndex((g) =>
    questionsInGroup(chapter, g).some((q) => isOpen(q, answers)),
  );
  return byFollowUp === -1 ? groups.length : byFollowUp;
}

/** Everything still open in a chapter — what the end-of-chapter screen owes the seller. */
export function openQuestions(
  chapter: ChapterId,
  answers: AnswerMap,
): Question[] {
  return questionsInChapter(chapter).filter((q) => isOpen(q, answers));
}

/**
 * An answer as the seller should see it quoted back to them.
 *
 * Used by the review screen, where the whole point is showing both sides of a
 * contradiction in the seller's own terms — never the raw stored value, and
 * never the statute wording.
 */
export interface AnswerSummary {
  questionId: string;
  label: string;
  value: string;
  /** What they actually said, when it came from the voice path. */
  verbatim?: string;
  status: string;
}

export function describeAnswer(
  questionId: string,
  answers: AnswerMap,
): AnswerSummary | null {
  const q = resolveQuestion(questionId);
  if (!q) return null;
  const a = answers[questionId];
  const label = q.sellerLabel ?? q.label;

  if (!a || a.status === "unanswered") {
    return { questionId, label, value: "not answered yet", status: "unanswered" };
  }
  if (a.status === "unknown") {
    return { questionId, label, value: "not sure", status: a.status, verbatim: a.verbatim };
  }
  if (a.status === "skipped") {
    return { questionId, label, value: "set aside for later", status: a.status };
  }

  const optionLabel = (v: string) =>
    q.options?.find((o) => o.value === v)?.label ?? v;

  const value =
    a.value === true
      ? "yes"
      : a.value === false
        ? "no"
        : Array.isArray(a.value)
          ? a.value.map(optionLabel).join(", ") || "nothing selected"
          : typeof a.value === "string"
            ? optionLabel(a.value)
            : a.value === null
              ? "blank"
              : String(a.value);

  return { questionId, label, value, status: a.status, verbatim: a.verbatim };
}
