/**
 * Assertions for how the registry projects into the form. No DB, no browser.
 */

import assert from "node:assert/strict";
import { QUESTIONS, groupsInChapter, questionsInChapter, getQuestion } from "../src/tds/registry";
import {
  firstIncompleteGroup,
  focusableQuestion,
  isPresenceChip,
  questionsInGroup,
} from "../src/tds/form-view";
import { deferredQuestions, inDeferralPass, makeAnswer, nextQuestion } from "../src/tds/flow";
import {
  composeExplanations,
  composedText,
  explanationSources,
  toFieldValues,
} from "../src/tds/docuseal";
import { detectConflicts } from "../src/tds/conflicts";
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

// The `?q=` handoff. A seller who has just said "yes, there's a fire alarm" and
// asked for the buttons must land on the fire alarm, not at the top of a
// fifty-question chapter — and every way that can go wrong has to be a quiet
// no-op, because "your link is invalid" is where a seller at 10pm stops.
{
  assert.equal(
    focusableQuestion("features", "A.fire_alarm", {}),
    "A.fire_alarm",
    "the question the seller was on must be pointable-at",
  );

  // Nothing that would not be on screen anyway.
  assert.equal(focusableQuestion("features", "A.no_such_thing", {}), null, "unknown id");
  assert.equal(focusableQuestion("features", "", {}), null, "empty id");
  assert.equal(focusableQuestion("features", null, {}), null, "absent id");
  assert.equal(
    focusableQuestion("features", "C.7", {}),
    null,
    "a question belonging to another chapter is not this chapter's business",
  );
  assert.equal(
    focusableQuestion("confirm", "meta.county", {}),
    null,
    "the listing agent's own fields are never shown to the seller",
  );

  // A gate that has since closed is the realistic stale case: the seller
  // changed an answer, the follow-up went away, the link in their pocket did
  // not. It must degrade to the top of the chapter, never to an error.
  assert.equal(
    focusableQuestion("features", "A.fireplace_location", {}),
    null,
    "a question whose gate is shut is not on screen to point at",
  );
  assert.equal(
    focusableQuestion("features", "A.fireplace_location", {
      "A.fireplace": makeAnswer("A.fireplace", true, "voice"),
    }),
    "A.fireplace_location",
    "and is pointable-at once the gate opens",
  );

  // Follow-ups are synthesised, not stored, and voice hands them back by id
  // constantly — "tell me more about that" is most of the voice path.
  const said: AnswerMap = {
    "A.not_operating": makeAnswer("A.not_operating", true, "voice"),
  };
  assert.equal(
    focusableQuestion("condition", "A.not_operating.explanation", said),
    "A.not_operating.explanation",
    "a follow-up must survive the handoff — it is what voice was mid-sentence on",
  );
  assert.equal(
    focusableQuestion("condition", "A.not_operating.explanation", {}),
    null,
    "but not before its parent has been answered",
  );

  console.log("✓ the ?q= handoff points at real questions and shrugs off stale ones");
}

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

// ---------------------------------------------------------------------------
// Composed explain boxes.
//
// The seller is shown "here's everything you told me" over these, so what the
// screen renders and what the PDF prints have to be the same string, produced
// by the same function. These assertions are the contract between the two.
// ---------------------------------------------------------------------------

// The sources are derived from the registry's followUp.into, never a hand-kept
// list of C.1-C.16. If someone adds a seventeenth, this picks it up for free.
{
  for (const q of QUESTIONS) {
    if (q.docuseal.kind !== "composed") continue;
    const sources = explanationSources(q.id);
    assert.ok(
      sources.length > 0,
      `${q.id} composes from nothing — its followUp.into targets are misspelled`,
    );
    for (const pid of sources) {
      assert.equal(
        getQuestion(pid)?.followUp?.into,
        q.id,
        `${pid} must declare ${q.id} as its follow-up target`,
      );
    }
  }
  const cSources = explanationSources("C.explain");
  assert.equal(cSources.length, 16, `expected 16 awareness sources, got ${cSources.length}`);
  console.log(`\n✓ composed sources derive from the registry (C.explain <- ${cSources.length})`);
}

/** Two awareness yeses, each explained in context, as voice would leave them. */
function twoExplained(): AnswerMap {
  const a: AnswerMap = {};
  a["C.7"] = makeAnswer("C.7", true, "voice");
  a["C.7.explanation"] = makeAnswer(
    "C.7.explanation",
    "The back patio settled about an inch in 2019.",
    "voice",
  );
  a["C.13"] = makeAnswer("C.13", true, "voice");
  a["C.13.explanation"] = makeAnswer(
    "C.13.explanation",
    "Foothill Terrace HOA, dues are $180 a month.",
    "voice",
  );
  return a;
}

// Composition produces the numbered narrative, and the seller sees the very
// string the PDF gets — not an empty box.
{
  const a = twoExplained();
  const expected =
    "7. The back patio settled about an inch in 2019.  " +
    "13. Foothill Terrace HOA, dues are $180 a month.";

  assert.equal(composedText("C.explain", a).composed, expected);
  assert.equal(
    composedText("C.explain", a).value,
    expected,
    "with nothing stored, the box the seller reads is the assembled draft",
  );
  assert.equal(toFieldValues(a)["c_explain"], expected, "and that is what prints");
  assert.equal(composedText("C.explain", a).edited, false);
  assert.equal(composedText("C.explain", a).stale, false);

  // Numbering belongs to composeExplanations and nowhere else.
  assert.equal(composeExplanations(a, explanationSources("C.explain")), expected);

  // Order follows the registry, not the order the seller happened to answer in.
  const backwards: AnswerMap = {};
  backwards["C.13"] = a["C.13"];
  backwards["C.13.explanation"] = a["C.13.explanation"];
  backwards["C.7"] = a["C.7"];
  backwards["C.7.explanation"] = a["C.7.explanation"];
  assert.equal(composedText("C.explain", backwards).value, expected, "numbering must stay in order");

  console.log("✓ composition numbers the seller's own explanations, in registry order");
}

// A box fed by one un-numbered question must not print "components. ...".
{
  const a: AnswerMap = {};
  a["B.gate"] = makeAnswer("B.gate", true, "voice");
  a["B.components"] = makeAnswer("B.components", ["roof"], "form");
  a["B.components.explanation"] = makeAnswer(
    "B.components.explanation",
    "The roof leaks over the garage when it rains hard.",
    "voice",
  );
  assert.equal(
    composedText("B.explain", a).value,
    "The roof leaks over the garage when it rains hard.",
    "a single un-numbered source gets no number prefix",
  );
  // And the "explanation is still empty" nudge must not fire at someone who
  // explained it in context — the box is not blank, it is composed.
  assert.equal(
    detectConflicts(a).some((c) => c.ruleId === "b_yes_no_explanation"),
    false,
    "a composed explanation must count as an explanation",
  );
  console.log("✓ un-numbered sources compose cleanly and satisfy the explain-is-empty rule");
}

// The seller's own edit wins, and recomposition never writes over it.
{
  const a = twoExplained();
  const mine = "The patio dipped after the 2019 storms. We had it looked at and it has not moved since.";
  a["C.explain"] = makeAnswer("C.explain", mine, "form");

  const after = composedText("C.explain", a);
  assert.equal(after.value, mine, "the stored edit is what the seller sees");
  assert.equal(after.edited, true);
  assert.equal(toFieldValues(a)["c_explain"], mine, "and the stored edit is what prints");

  // A later answer changes the draft. The edit still stands; the difference is
  // surfaced as `stale` so the seller can be offered a choice, never overruled.
  a["C.9"] = makeAnswer("C.9", true, "voice");
  a["C.9.explanation"] = makeAnswer("C.9.explanation", "A neighbor's fence crosses the line.", "voice");

  const later = composedText("C.explain", a);
  assert.equal(later.value, mine, "recomposition must not overwrite the seller's text");
  assert.equal(toFieldValues(a)["c_explain"], mine);
  assert.equal(later.stale, true, "but the seller must be told the draft moved on");
  assert.ok(
    later.composed.includes("9. A neighbor's fence crosses the line."),
    "and the newer draft must be available to offer them",
  );

  // Clearing the box is an edit too. Refilling it would be auto-correcting an
  // answer they deliberately removed.
  a["C.explain"] = makeAnswer("C.explain", "", "form");
  assert.equal(composedText("C.explain", a).value, "", "an emptied box stays empty");
  assert.equal(
    "c_explain" in toFieldValues(a),
    false,
    "an emptied box must not be silently recomposed onto the PDF",
  );

  console.log("✓ the seller's edit persists, survives recomposition, and can be cleared");
}

// Nothing to compose: no yes answers, so there is nothing to read over.
{
  const a: AnswerMap = {};
  for (const pid of explanationSources("C.explain")) {
    a[pid] = makeAnswer(pid, false, "voice");
  }
  const empty = composedText("C.explain", a);
  assert.equal(empty.composed, "", "nothing answered yes, so nothing composes");
  assert.equal(empty.value, "");
  assert.equal(empty.edited, false, "an empty draft is not an edit");
  assert.equal(empty.stale, false);
  assert.equal("c_explain" in toFieldValues(a), false, "an empty box leaves the PDF field alone");

  // A yes with no explanation yet also composes to nothing — the box has to
  // admit that rather than show a blank under "here's everything you told me".
  a["C.7"] = makeAnswer("C.7", true, "voice");
  assert.equal(composedText("C.explain", a).composed, "", "a yes with no words yet composes to nothing");

  // The seller can still put something there of their own accord.
  a["C.explain"] = makeAnswer("C.explain", "Nothing to add.", "form");
  const own = composedText("C.explain", a);
  assert.equal(own.value, "Nothing to add.");
  assert.equal(own.edited, true);
  assert.equal(toFieldValues(a)["c_explain"], "Nothing to add.");

  console.log("✓ the empty case composes to nothing and stays out of the PDF");
}

console.log("composed-explanation checks passed\n");
