/**
 * Assertions for how the registry projects into the form. No DB, no browser.
 */

import assert from "node:assert/strict";
import { groupsInChapter, questionsInChapter, getQuestion } from "../src/tds/registry";
import { firstIncompleteGroup, isPresenceChip, questionsInGroup } from "../src/tds/form-view";
import { makeAnswer } from "../src/tds/flow";
import type { AnswerMap } from "../src/tds/types";

const CH = "features" as const;
const groups = groupsInChapter(CH);

// Presence chips are nouns; anything phrased as a question gets an explicit
// Yes/No. If someone rewords a label, this is what tells them they moved it.
const chips = questionsInChapter(CH).filter(isPresenceChip);
const asked = questionsInChapter(CH).filter(
  (q) => q.type === "boolean" && !isPresenceChip(q),
);
assert.ok(chips.length > 30, `expected the bulk of the chapter to be chips, got ${chips.length}`);
for (const q of asked) {
  assert.ok(
    (q.sellerLabel ?? q.label).endsWith("?"),
    `${q.id} is a non-chip boolean but is not phrased as a question`,
  );
}
// The safety questions must never become tap-to-add chips.
for (const id of ["A.pool_child_barrier", "A.quick_release", "A.hot_tub_locking_cover"]) {
  assert.equal(isPresenceChip(getQuestion(id)!), false, `${id} must get an explicit Yes/No`);
}
console.log(`✓ ${chips.length} presence chips, ${asked.length} explicit yes/no questions`);

// Every group must be reachable. A group made only of follow-ups (Roof) has no
// chips, so a chips-only completeness rule would skip it forever.
const answers: AnswerMap = {};
const seen = new Set<number>();
for (let step = 0; step < 200; step++) {
  const index = firstIncompleteGroup(CH, answers);
  if (index >= groups.length) break;
  seen.add(index);
  // answer everything currently open in that group, as the UI's confirm does
  for (const q of questionsInGroup(CH, groups[index])) {
    if (answers[q.id]) continue;
    answers[q.id] = makeAnswer(q.id, isPresenceChip(q) ? false : "x", "form");
  }
}
assert.equal(
  seen.size,
  groups.length,
  `every group must be reachable; reached ${seen.size} of ${groups.length}`,
);
assert.equal(firstIncompleteGroup(CH, answers), groups.length, "chapter must terminate");
console.log(`✓ all ${groups.length} groups reachable, chapter terminates`);

// An open follow-up must not drag the seller backwards past answered chips.
const midflow: AnswerMap = {};
for (const q of questionsInChapter(CH).filter(isPresenceChip)) {
  midflow[q.id] = makeAnswer(q.id, false, "form");
}
midflow["A.fireplace"] = makeAnswer("A.fireplace", true, "form");
const landing = firstIncompleteGroup(CH, midflow);
assert.equal(
  groups[landing],
  "Heating & cooling",
  `an open follow-up should be collected once chips are done, landed on ${groups[landing]}`,
);
console.log("✓ open follow-ups are collected, not skipped");
console.log("form checks passed\n");
