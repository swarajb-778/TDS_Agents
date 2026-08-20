/**
 * How the registry projects into the form UI. Pure, no React — so it can be
 * asserted in a script rather than only exercised by clicking.
 */

import { groupsInChapter, questionsInChapter } from "./registry";
import { isVisible } from "./flow";
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
