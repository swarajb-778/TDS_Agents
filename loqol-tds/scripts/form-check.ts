/**
 * Assertions for how the registry projects into the form. No DB, no browser.
 */

import assert from "node:assert/strict";
import { groupsInChapter, questionsInChapter, getQuestion } from "../src/tds/registry";
import { firstIncompleteGroup, isPresenceChip, questionsInGroup } from "../src/tds/form-view";
import { deferredQuestions, inDeferralPass, makeAnswer, nextQuestion } from "../src/tds/flow";
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

// "Come back to this" has to mean something. A skipped question must not be
// handed straight back, and must not be silently dropped either.
{
  const map: AnswerMap = {};
  const first = nextQuestion(map).question!;
  map[first.id] = { ...makeAnswer(first.id, null, "form"), status: "skipped" };

  const after = nextQuestion(map).question!;
  assert.notEqual(after.id, first.id, "a skipped question must not be re-asked immediately");

  // answer everything else; the deferred one must then come back
  for (let i = 0; i < 300; i++) {
    const n = nextQuestion(map);
    if (n.done || !n.question) break;
    if (n.question.id === first.id) break;
    const q = n.question;
    map[q.id] = makeAnswer(
      q.id,
      q.type === "boolean" ? false
        : q.type === "number" ? 0
        : q.type === "enum" ? q.options![0].value
        : q.type === "multi_enum" ? [q.options![0].value]
        : q.type === "acknowledgement" ? true
        : "x",
      "form",
    );
  }
  assert.equal(
    nextQuestion(map).question?.id,
    first.id,
    "a skipped question must come back once nothing new is left",
  );
  assert.deepEqual(
    deferredQuestions(map).map((q) => q.id),
    [first.id],
    "deferredQuestions must list exactly what was set aside",
  );
  console.log("✓ skipped questions defer to the end and do come back");
}

// Deferral must not become its own trap. Skip the last outstanding question
// and the seller would otherwise be handed it back forever.
{
  const map: AnswerMap = {};
  for (let i = 0; i < 300; i++) {
    const n = nextQuestion(map);
    if (n.done || !n.question) break;
    const q = n.question;
    if (map[q.id]) break; // already handled: we are looping on a deferred one
    map[q.id] = makeAnswer(
      q.id,
      q.type === "boolean" ? false
        : q.type === "number" ? 0
        : q.type === "enum" ? q.options![0].value
        : q.type === "multi_enum" ? [q.options![0].value]
        : q.type === "acknowledgement" ? true
        : "x",
      "form",
    );
  }
  assert.equal(inDeferralPass(map), false, "a fully answered form is not in deferral");

  const last = Object.keys(map).at(-1)!;
  map[last] = { ...map[last], status: "skipped", value: null };
  assert.equal(inDeferralPass(map), true, "skipping the last question enters the deferral pass");
  assert.equal(
    nextQuestion(map).question?.id,
    last,
    "and the deferred question is what is offered",
  );
  console.log("✓ deferral pass is detectable, so it can offer a way out");
}
