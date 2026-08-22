/**
 * Exercises the voice path's server side by calling the route handler directly
 * with the tool calls the model would make. No browser, no microphone.
 *
 * What is actually being asserted: the model cannot move the queue, cannot
 * write an unvalidated answer, and cannot talk its way past a low-confidence
 * reading.
 */

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../src/db/index";
import { agents, deals, disclosureRequests } from "../src/db/schema";
import { loadAnswers } from "../src/db/answers";
import { hashPassword, hashToken } from "../src/db/crypto";
import { agentQueue, makeAnswer } from "../src/tds/flow";
import { isLikelyHallucination, voiceInstructions } from "../src/tds/voice";
import {
  SIGNER_FIELDS,
  buildSubmission,
  expectedFieldNames,
} from "../src/tds/docuseal";
import {
  NUDGE_AFTER_MS,
  isActiveResponseClash,
  isPending,
  replay,
} from "../src/tds/voice-turns";
import { runVoiceTool } from "../src/app/api/voice/tool/route";

const AGENT_ID = "eeeeeeee-0000-4000-8000-000000000001";
const DEAL_ID = "eeeeeeee-0000-4000-8000-0000000000e1";
const TOKEN = "voice-check-token";
/** Set by setup(); it is the actor id on every answer the seller writes. */
let REQUEST_ID = "";

/**
 * The seller is identified by their session cookie in the real route, which is
 * a request concern. This exercises the half that matters here — what a tool
 * call actually does — with the identity supplied directly.
 */
async function call(name: string, args: Record<string, unknown>) {
  return (await runVoiceTool(
    { dealId: DEAL_ID, requestId: REQUEST_ID },
    name,
    args,
  )) as unknown as Record<string, unknown>;
}

async function setup() {
  await db.delete(agents).where(eq(agents.id, AGENT_ID));
  await db.insert(agents).values({
    id: AGENT_ID,
    email: "voice-check@loqol.test",
    passwordHash: hashPassword("scratch"),
    name: "voice-check",
  });
  await db.insert(deals).values({
    id: DEAL_ID,
    agentId: AGENT_ID,
    sellerName: "Scratch Seller",
    sellerEmail: "scratch@loqol.test",
    propertyAddress: "nowhere",
  });
  const [request] = await db
    .insert(disclosureRequests)
    .values({
      dealId: DEAL_ID,
      tokenHash: hashToken(TOKEN),
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning({ id: disclosureRequests.id });
  REQUEST_ID = request.id;
}

await setup();

// 1. A hedged answer is not an answer. Below the threshold the write is
//    rejected and the agent is sent back to the same question.
const hedged = await call("record_answer", {
  question_id: "C.7",
  value: true,
  confidence: 0.4,
  verbatim: "I mean... maybe? There was something with the patio.",
});
assert.equal(hedged.ok, false, "low confidence must be rejected");
assert.equal(hedged.next_question_id, "C.7", "a rejected write must re-ask the same question");
assert.match(String(hedged.reason), /confidence/i);
console.log("✓ low-confidence writes rejected and re-asked, not guessed");

// 2. A wrongly typed value is rejected even at high confidence — the model
//    cannot invent a shape the registry does not allow.
const wrongType = await call("record_answer", {
  question_id: "C.7",
  value: "probably",
  confidence: 0.99,
  verbatim: "probably",
});
assert.equal(wrongType.ok, false, "a string is not a boolean, however confident the model is");
console.log("✓ registry type validation holds against a confident model");

// 3. A yes pulls its own follow-up to the front, chosen by flow.ts.
const yes = await call("record_answer", {
  question_id: "C.13",
  value: true,
  confidence: 0.93,
  verbatim: "Yeah there's an HOA.",
});
assert.equal(yes.ok, true);
assert.equal(
  yes.next_question_id,
  "C.13.explanation",
  "the explanation must be captured before moving on",
);
console.log("✓ a yes queue-jumps to its explanation");

const explained = await call("record_explanation", {
  question_id: "C.13.explanation",
  text: "Foothill Terrace Homeowners Association, about $240 a month.",
  verbatim: "Foothill Terrace, like two forty a month",
});
assert.equal(explained.ok, true, "synthesised follow-ups must be writable");
console.log("✓ explanations persist");

// 4. Conflicts surface as a question, never as a correction or a block.
const clash = await call("record_answer", {
  question_id: "C.12",
  value: false,
  confidence: 0.88,
  verbatim: "No, nobody's sent me any CC and Rs.",
});
assert.equal(clash.ok, true, "a conflicting answer must still be recorded");
assert.ok(typeof clash.note === "string" && clash.note.length > 0, "the clash must be surfaced");
assert.doesNotMatch(String(clash.note), /error|wrong|incorrect/i, "never tell the seller they are wrong");
assert.ok(clash.next_question_id, "a conflict must not stop the flow");
console.log("✓ conflicts surface as a note and never block");

// 5. "I don't know" is an answer and routes to the agent.
const unknown = await call("mark_unknown", {
  question_id: "C.6",
  reason: "Bought the house in 2019, no idea what happened before.",
});
assert.equal(unknown.ok, true);
const queued = agentQueue(await loadAnswers(DEAL_ID)).map((q) => q.id);
assert.ok(queued.includes("C.6"), "unknowns must reach the agent's queue");
console.log("✓ \"I don't know\" is recorded and routed to the agent");

// 6. Switching to the form writes nothing and does not argue.
const before = Object.keys(await loadAnswers(DEAL_ID)).length;
const handoff = await call("switch_to_form", { question_id: "C.9" });
assert.equal(handoff.hand_off_to_form, "C.9", "the handoff must name the question");
assert.equal(
  Object.keys(await loadAnswers(DEAL_ID)).length,
  before,
  "changing input method must not change the answers",
);
// ...and it hands over even when the model forgets to say which question, or
// names one that does not exist. "Can I just tap this?" is the one request that
// must never come back as an error — the bookmark is worth losing, the seller
// is not. An unusable id comes back empty so the client falls back to the
// question the server last handed out.
for (const args of [{}, { question_id: "" }, { question_id: "C.99" }]) {
  const loose = await call("switch_to_form", args);
  assert.equal(loose.ok, true, `switch_to_form must not be refused for ${JSON.stringify(args)}`);
  assert.equal(
    loose.hand_off_to_form,
    "",
    "an id that names nothing must not be passed off as a place to look",
  );
}
assert.equal(
  Object.keys(await loadAnswers(DEAL_ID)).length,
  before,
  "and still writes nothing",
);
console.log("✓ switch_to_form hands over instantly and writes nothing");

// 7. An unknown question id is refused outright.
const bogus = await call("record_answer", {
  question_id: "C.99",
  value: true,
  confidence: 0.99,
  verbatim: "sure",
});
assert.equal(bogus.ok, false, "a hallucinated question id must be refused");
console.log("✓ hallucinated question ids refused");

// 8. Transcribers hallucinate on room noise. These are not invented examples:
//    they are what whisper-1 actually returned for five seconds of synthetic
//    room tone, three runs out of three. Words the seller never said must never
//    appear attributed to them.
for (const noise of [
  "\u3054\u8996\u8074\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3057\u305f", // "thank you for watching"
  "Thank you for watching.",
  "Thanks for watching!",
  ". ",
  ".",
  "",
  "   ",
  "[BLANK_AUDIO]",
  "(silence)",
  "Thank you.",
  "Bye.",
  "you",
  "Please subscribe",
]) {
  assert.equal(
    isLikelyHallucination(noise),
    true,
    `transcriber noise must not reach the seller's transcript: ${JSON.stringify(noise)}`,
  );
}

// And the filter must not swallow anything a seller would actually say.
for (const real of [
  "Yeah there's an HOA, Foothill Terrace something.",
  "No, nothing like that.",
  "Yes",
  "No",
  "I don't know",
  "The back patio settled about an inch in 2019.",
  "Thank you, yes there is a pool",
  "Bye the way, there is a shared driveway",
]) {
  assert.equal(
    isLikelyHallucination(real),
    false,
    `real seller speech must not be filtered: ${JSON.stringify(real)}`,
  );
}
console.log("\u2713 transcriber hallucinations filtered, real answers kept");

// The seller must never be walked through the form again at signing time.
// Locking only the *filled* fields leaves every blank one editable, and
// DocuSeal then asks for each of them in the form's own language.
{
  const payload = buildSubmission({
    templateId: 1,
    answers: {},
    sellers: [{ role: "", email: "seller@loqol.test" }],
    listingAgent: { role: "", email: "agent@loqol.test" },
  });
  const locked = payload.submitters[0].readonly_fields;

  const interview = expectedFieldNames().filter(
    (n) => !SIGNER_FIELDS.some((f) => f.name === n),
  );
  for (const name of interview) {
    assert.ok(
      locked.includes(name),
      `${name} must be locked even with no answer — a blank is deliberate, not a prompt`,
    );
  }
  // And the only things the seller is actually here to do stay open.
  for (const field of SIGNER_FIELDS) {
    assert.ok(
      !locked.includes(field.name),
      `${field.name} must stay signable`,
    );
  }
  console.log(
    `\u2713 all ${interview.length} interview fields locked at signing, ${SIGNER_FIELDS.length} signer fields open`,
  );
}

// 9. The instructions carry the rules that keep this honest.
const prompt = voiceInstructions("awareness", "Marcus", {});
for (const [label, pattern] of [
  ["never invent facts", /never write down a fact the seller did not say/i],
  ["unknown vs not aware", /not aware of any/i],
  ["no legal advice", /not a lawyer/i],
  ["no pushback on switching", /do not talk them out of it/i],
  ["server owns the order", /you do not decide what comes next/i],
  ["ask what the server returned", /ask\s+\\?`?next_prompt\\?`?\s+out loud/i],
  ["one tool call at a time", /call one tool at a time/i],
  ["stop at the end of a part", /this part of the form is finished/i],
  ["say nothing to a silent turn", /say nothing at all and keep\s+waiting/i],
  ["never answer from a silent turn", /never record an answer from it/i],
] as const) {
  assert.match(prompt, pattern, `system prompt must state: ${label}`);
}
assert.match(prompt, /C\.13/, "the brief must carry the actual questions");

// A question the seller already answered — by tapping it, or in an earlier
// sitting — must be marked as done, or the agent reads the chapter from the top
// and asks it again.
const partly = voiceInstructions("awareness", "Marcus", {
  "C.13": makeAnswer("C.13", true, "form"),
  "C.4": { ...makeAnswer("C.4", null, "form"), status: "unknown" },
});
assert.match(partly, /C\.13: ALREADY ANSWERED/, "a tapped answer must be marked done");
assert.match(partly, /C\.4: ALREADY ANSWERED \(unknown\)/, "so must an unknown");
assert.doesNotMatch(
  partly.split("C.13: ALREADY ANSWERED")[1].split("\n\n")[0],
  /ask:/,
  "an answered question must not still carry its ask wording",
);
assert.match(partly, /Begin with/, "the agent must be told where to start");
assert.match(prompt, /Begin with C\.1\b/, "an untouched chapter starts at the top");
console.log("✓ system prompt states every rule that keeps this honest");

// 10. Every result carries the signal the screen needs to show a way onward.
//
//     Without this the seller finishes a part, the agent goes quiet, and there
//     is nothing on screen saying so — they sit waiting for a question that is
//     never coming.
for (const [what, result] of [["a recorded answer", yes], ["an explanation", explained], ["a conflict", clash]] as const) {
  assert.equal(
    typeof result.entering_chapter,
    "boolean",
    `${what} must say whether the next question leaves this part of the form`,
  );
  assert.equal(
    result.done === true,
    result.next_question_id === null,
    `${what}: "finished" and "nothing to ask next" must never disagree`,
  );
  if (result.done !== true) {
    assert.ok(
      typeof result.next_chapter === "string" && result.next_chapter.length > 0,
      `${what} must name the part the next question belongs to`,
    );
  }
}
console.log("✓ every tool result says where the seller is and whether this part is done");

// 11. THE STALL.
//
//     Realtime allows one open response at a time and refuses a second
//     outright — `conversation_already_has_active_response`, not queued, not
//     retried. And `response.function_call_arguments.done`, the only signal
//     that a tool was called, is emitted while that response is STILL OPEN.
//     So a `response.create` fired the moment a tool round-trip returned was
//     landing inside the response that made the call: refused, silently. The
//     answer was already written, which is why it looked like the agent had
//     simply forgotten to carry on.
//
//     Replayed here event for event. Indices are which event released the
//     create — asserting the count alone would miss the whole point, which is
//     that it has to WAIT.

// (a) The model speaks and calls a tool in the same response. The create is
//     held until that response closes, and then it goes.
const spoke = replay([
  { type: "response.created" },           // 0 — the model starts talking
  { type: "tool.called", callId: "c1" },  // 1 — ...and calls a tool as it does
  { type: "tool.settled", callId: "c1" }, // 2 — server answers, mid-response
  { type: "response.done" },              // 3 — the spoken line finishes
]);
assert.deepEqual(
  spoke.creates,
  [3],
  "the ask must wait for response.done — sending it at 2 is the stall",
);

// (b) Several tool calls in one response earn ONE reply, once the last is back.
const parallel = replay([
  { type: "response.created" },
  { type: "tool.called", callId: "c1" },
  { type: "tool.called", callId: "c2" },
  { type: "response.done" },
  { type: "tool.settled", callId: "c1" },
  { type: "tool.settled", callId: "c2" }, // 5
]);
assert.deepEqual(parallel.creates, [5], "two tool calls must not race two replies");

// (c) A refused create is remembered and re-sent, never dropped.
const bounced = replay([
  { type: "tool.called", callId: "c1" },
  { type: "tool.settled", callId: "c1" }, // 1 — we ask
  { type: "response.rejected" },          // 2 — refused: something was open
  { type: "response.done" },              // 3 — it closes; ask again
]);
assert.deepEqual(bounced.creates, [1, 3], "a refused ask must be retried, not swallowed");

// (d) And a want that somehow still goes unanswered is re-sent by the watchdog —
//     but not so eagerly that it talks over a reply already on its way.
const stalled = replay([
  [{ type: "tool.called", callId: "c1" }, 0],
  [{ type: "tool.settled", callId: "c1" }, 1_000], // 1 — asked at t=1000
  [{ type: "nudge" }, 3_000],                      // 2 — too soon, held
  [{ type: "nudge" }, 1_000 + NUDGE_AFTER_MS],     // 3 — now
]);
assert.deepEqual(stalled.creates, [1, 3], "the watchdog re-asks, but only after the grace period");

// (e) Nothing is re-sent while the agent is genuinely speaking.
const speaking = replay([
  { type: "tool.called", callId: "c1" },
  { type: "tool.settled", callId: "c1" },
  { type: "response.created" },
  [{ type: "nudge" }, 600_000],
]);
assert.deepEqual(speaking.creates, [1], "never interrupt a reply that is already happening");
console.log("✓ the agent is asked to move on exactly once, and never left unasked");

// 12. The seller can see the wait, and only the waits that are real.
assert.equal(
  isPending(replay([{ type: "tool.called", callId: "c1" }]).state),
  true,
  "a tool call in flight must show as pending — several seconds of silence reads as a hang",
);
assert.equal(isPending(speaking.state), false, "but not while the agent is talking");
assert.equal(isPending(replay([]).state), false, "and not before anything has happened");

// A clash is our timing bug, not the seller's news. Anything else still is.
assert.equal(
  isActiveResponseClash({ code: "conversation_already_has_active_response" }),
  true,
);
assert.equal(
  isActiveResponseClash({ message: "Conversation already has an active response" }),
  true,
);
assert.equal(
  isActiveResponseClash({ code: "session_expired", message: "Your session has expired" }),
  false,
  "a real failure must still reach the seller",
);
console.log("✓ pending shown when waiting, and our own timing errors kept off the screen");

// ===========================================================================
// Found by driving scripted conversations through runVoiceTool and the turn
// reducer from text — no microphone, no browser. Each block below is one bug
// that harness caught; the harness itself is gone.
// ===========================================================================

import { answers as answersTable, answerEvents } from "../src/db/schema";
import { answerHistory, writeAnswer } from "../src/db/answers";
import {
  agentQueue as queueFor,
  nextInChapter,
  nextQuestion,
  resolveQuestion,
} from "../src/tds/flow";
import { canAskAloud } from "../src/tds/voice";
import { CHAPTERS, questionsInChapter } from "../src/tds/registry";
import type { AnswerMap } from "../src/tds/types";

/** Start a scenario from an empty disclosure, answers and audit rows alike. */
async function blank() {
  await db.delete(answersTable).where(eq(answersTable.dealId, DEAL_ID));
  await db.delete(answerEvents).where(eq(answerEvents.dealId, DEAL_ID));
}

// 13. THE PART THAT ENDED AFTER ONE ANSWER.
//
//     A voice session covers one chapter. The endpoint used to answer "what
//     next" with nextQuestion(), which is a different question — where is the
//     seller in the WHOLE form. A seller who opened the awareness chapter with
//     an earlier chapter still unfinished got, after their very first answer,
//     a next question two chapters back and `entering_chapter: true`. The
//     screen then told them "That's this part done" with fifteen questions
//     left, and the agent was instructed to stop talking.
await blank();
{
  const first = await call("record_answer", {
    question_id: "C.1",
    value: false,
    confidence: 0.95,
    verbatim: "no, nothing like that",
  });
  assert.equal(first.ok, true);
  assert.equal(
    first.next_question_id,
    "C.2",
    "the next question must come from the part being talked through, not the whole form",
  );
  assert.equal(first.next_chapter, "awareness");
  assert.equal(
    first.entering_chapter,
    false,
    "one answer of sixteen is not the end of the part",
  );
  assert.ok(first.next_prompt, "and there must be something to ask");
  console.log("✓ a chapter ends when the chapter ends, not when an earlier one is unfinished");
}

// 14. A COMPOSED BOX IS NOT A QUESTION.
//
//     A.not_operating_describe, B.explain and C.explain hold no answer of their
//     own — they are assembled from the per-question explanations the agent has
//     already collected, and their wording is a near copy of the follow-up that
//     filled them. Handed to the agent, the seller was asked "tell me which
//     ones and roughly what's going on with each" and then, the instant they
//     finished answering, asked it again word for word.
for (const id of ["A.not_operating_describe", "B.explain", "C.explain"]) {
  assert.equal(
    canAskAloud(resolveQuestion(id)!),
    false,
    `${id} is a drafted box, not a question — asking it aloud asks for the same words twice`,
  );
}
// And a question the registry keeps on screen is a screen job. B.components is
// sixteen checkboxes the seller is meant to WATCH tick; read out it is a
// different question with a worse answer.
assert.equal(canAskAloud(resolveQuestion("B.components")!), false);
assert.equal(canAskAloud(resolveQuestion("C.7")!), true, "but the spoken questions stay spoken");
assert.equal(canAskAloud(resolveQuestion("C.7.explanation")!), true, "including their follow-ups");

await blank();
{
  const broken = await call("record_answer", {
    question_id: "A.not_operating",
    value: true,
    confidence: 0.94,
    verbatim: "yeah the oven's second element is dead",
  });
  assert.equal(broken.next_question_id, "A.not_operating.explanation");
  const asked = broken.next_prompt;
  const after = await call("record_explanation", {
    question_id: "A.not_operating.explanation",
    text: "The oven's second element stopped heating about a year ago.",
    verbatim: "oven element's dead",
  });
  assert.notEqual(
    after.next_prompt,
    asked,
    "the agent must never be handed back the question it has just been answered",
  );
  assert.equal(
    after.next_prompt,
    null,
    "with nothing left to say out loud the agent is given nothing to say",
  );
  assert.equal(after.entering_chapter, true, "and the screen is told to offer a way onward");
  console.log("✓ the agent is never handed a screen question, or the same question twice");
}

// 15. NO CONFIDENCE IS NOT HIGH CONFIDENCE.
//
//     The threshold is only applied to a number that arrives. A model that
//     omitted the field — or sent "0.4" as a string, which they do — walked an
//     unmeasured answer past the one gate that stops a guess, and left a null
//     confidence next to it in the audit trail of a document signed under
//     penalty.
for (const [what, confidence] of [
  ["omitted", undefined],
  ["a string", "0.4"],
  ["not a number", "high"],
  ["NaN", Number.NaN],
] as const) {
  await blank();
  const args: Record<string, unknown> = {
    question_id: "C.7",
    value: true,
    verbatim: "uhh I guess so",
  };
  if (confidence !== undefined) args.confidence = confidence;
  const r = await call("record_answer", args);
  assert.equal(r.ok, false, `confidence ${what} must be rejected, not treated as certainty`);
  assert.equal(r.next_question_id, "C.7", "and the agent re-asks");
  assert.equal(
    Object.keys(await loadAnswers(DEAL_ID)).length,
    0,
    `confidence ${what} must leave nothing behind`,
  );
  assert.equal((await answerHistory(DEAL_ID, "C.7")).length, 0, "not even an audit row");
}
console.log("✓ an unmeasured answer is refused, and writes nothing");

// 16. AN EMPTY EXPLANATION IS WORSE THAN NONE.
//
//     "" is valid long_text as far as the registry is concerned, so a blank
//     record_explanation was accepted. That marks the follow-up answered, flow
//     stops asking for it, and the shared box prints empty beside a yes the
//     seller signed.
await blank();
{
  await call("record_answer", {
    question_id: "C.13",
    value: true,
    confidence: 0.93,
    verbatim: "yeah there's an HOA",
  });
  for (const text of ["", "   "]) {
    const r = await call("record_explanation", { question_id: "C.13.explanation", text });
    assert.equal(r.ok, false, "a blank explanation must be refused");
    assert.equal(r.next_question_id, "C.13.explanation", "and asked again");
  }
  const missing = await call("record_explanation", { question_id: "C.13.explanation" });
  assert.equal(missing.ok, false, "and a missing one too");
  assert.equal(
    nextQuestion(await loadAnswers(DEAL_ID), "C.13").question?.id,
    "C.13.explanation",
    "the follow-up must still be outstanding, not quietly satisfied by nothing",
  );
  console.log("✓ a blank explanation is refused and the follow-up stays owed");
}

// 17. THE ONE TOOL THAT MUST NEVER FAIL.
//
//     switch_to_form used to go through the same "is this a real question"
//     guard as a write. A model calling it with no question_id — which is what
//     happens when the seller says "can I just tap this" before the first
//     question has landed — was refused, and kept talking. That is talking a
//     seller out of switching by accident, which is the one thing this path is
//     told never to do.
for (const id of ["C.9", "", "C.99", "not a question at all"]) {
  const r = await call("switch_to_form", { question_id: id });
  assert.equal(r.ok, true, `switch_to_form must succeed with question_id ${JSON.stringify(id)}`);
  assert.equal(
    typeof r.hand_off_to_form,
    "string",
    "the client switches on this field; it has to be there",
  );
}
assert.equal(
  (await call("switch_to_form", { question_id: "C.9" })).hand_off_to_form,
  "C.9",
  "a good id is still passed through, so the form opens where they were",
);
console.log("✓ switching to the form cannot be refused, whatever the model names");

// 18. AN "I DON'T KNOW" ON AN EXPLANATION VANISHED.
//
//     agentQueue() filtered QUESTIONS, and follow-ups are synthesised rather
//     than stored. So the seller said yes to the fire question, could not
//     remember a single detail, was told it goes to their agent — and it did
//     not. The yes prints with an empty box under it and nobody is chasing it.
await blank();
{
  await call("record_answer", {
    question_id: "C.6",
    value: true,
    confidence: 0.9,
    verbatim: "there was a fire in 2011, before us",
  });
  const gaveUp = await call("mark_unknown", {
    question_id: "C.6.explanation",
    reason: "bought in 2019, no idea what happened",
  });
  assert.equal(gaveUp.ok, true);
  const queued = queueFor(await loadAnswers(DEAL_ID)).map((q) => q.id);
  assert.ok(
    queued.includes("C.6.explanation"),
    "an explanation the seller could not give is exactly what the agent has to chase",
  );
  console.log("✓ an unanswerable follow-up reaches the agent, not the void");
}

// 19. Answering again what was already tapped on the form.
//
//     Both readings have to hold: the seller's latest word wins, and the
//     earlier one is still there. This is a legal document — an overwrite that
//     erases what it overwrote is not an audit trail.
await blank();
await writeAnswer({
  dealId: DEAL_ID,
  questionId: "C.13",
  value: false,
  source: "form",
  actor: { type: "seller", id: REQUEST_ID },
});
{
  const changed = await call("record_answer", {
    question_id: "C.13",
    value: true,
    confidence: 0.9,
    verbatim: "oh wait, yes, there is an HOA",
  });
  assert.equal(changed.ok, true, "changing their mind out loud must be allowed");
  const now = await loadAnswers(DEAL_ID);
  assert.equal(now["C.13"].value, true, "the latest answer wins");
  assert.equal(now["C.13"].source, "voice", "and records which path produced it");
  const history = await answerHistory(DEAL_ID, "C.13");
  assert.equal(history.length, 2, "one row per write, never a replacement");
  assert.deepEqual(
    history.map((h) => [h.source, h.value]),
    [["form", false], ["voice", true]],
    "both sides of the change stay on the record, in order",
  );
  console.log("✓ a re-answer overwrites the answer and appends to the trail");
}

// 20. Walked end to end, twice: the queue never hands back a question it has
//     already been given an answer to. Once with every no — the short form —
//     and once with every yes, which turns on every gate and every follow-up.
for (const [shape, yes] of [["all no", false], ["all yes", true]] as const) {
  let map: AnswerMap = {};
  let current: string | undefined;
  const handedBack: string[] = [];
  let visited = 0;

  for (let i = 0; i < 500; i++) {
    const next = nextQuestion(map, current);
    if (next.done || !next.question) break;
    const q = next.question;
    if (map[q.id] && map[q.id].status !== "unanswered") handedBack.push(q.id);
    visited++;

    const value =
      q.type === "enum"
        ? q.options![0].value
        : q.type === "multi_enum"
          ? [q.options![0].value]
          : q.type === "number"
            ? 1
            : q.type === "boolean" || q.type === "acknowledgement"
              ? yes
              : "something the seller said";
    map = { ...map, [q.id]: makeAnswer(q.id, value, "form") };
    current = q.id;
  }

  assert.deepEqual(handedBack, [], `${shape}: an answered question must never come round again`);
  assert.ok(visited > 40, `${shape}: the walk must actually cover the form (got ${visited})`);
  assert.equal(nextQuestion(map).done, true, `${shape}: and it must end`);
  console.log(`✓ ${shape}: ${visited} questions, none asked twice, and it terminates`);
}

// 21. The brief and the queue must open on the same question.
//
//     voiceInstructions() picked the first unanswered question in the chapter
//     and ignored outstanding follow-ups, so a seller who tapped a yes on
//     screen and came back to voice was opened on the wrong question — and
//     handed the explanation a turn later, for a question the brief had just
//     marked ALREADY ANSWERED with no mention of it.
{
  const tapped: AnswerMap = {
    "C.1": makeAnswer("C.1", false, "form"),
    "C.2": makeAnswer("C.2", false, "form"),
    "C.3": makeAnswer("C.3", true, "form"),
  };
  // The same call the tool endpoint makes after every write.
  const owed = nextInChapter(tapped, "awareness", undefined, canAskAloud)?.id;
  assert.equal(owed, "C.3.explanation", "a tapped yes still owes its explanation");

  const briefed = voiceInstructions("awareness", "Marcus", tapped);
  assert.match(
    briefed,
    new RegExp(`Begin with ${owed!.replace(/\./g, "\\.")}\\b`),
    "the agent must open on the question the server is about to hand it",
  );
  assert.match(
    briefed,
    /C\.3\.explanation/,
    "and that question has to appear on the brief it was given",
  );
  console.log("✓ the brief opens on the same question the queue would hand over");
}

// 22. Standing down means standing down.
//
//     The client settles the handoff call and then abandons — but the model can
//     make two calls in one response, and the second settling re-raised the
//     want that was just cleared. The agent took the floor again after the
//     seller had already been handed to the form.
const straggler = replay([
  { type: "tool.called", callId: "c1" },
  { type: "tool.called", callId: "c2" },
  { type: "tool.settled", callId: "c1" }, // the switch_to_form result
  { type: "reply.abandoned" },
  { type: "tool.settled", callId: "c2" }, // 4 — must not restart the agent
]);
assert.deepEqual(straggler.creates, [], "nothing may take the floor after standing down");
assert.equal(isPending(straggler.state), false, "and nothing is still being waited on");

// Both orderings of two calls in one response earn exactly one reply. The
// existing check covers settle-after-done; this is settle-before-done.
assert.deepEqual(
  replay([
    { type: "response.created" },
    { type: "tool.called", callId: "c1" },
    { type: "tool.called", callId: "c2" },
    { type: "tool.settled", callId: "c1" },
    { type: "tool.settled", callId: "c2" },
    { type: "response.done" }, // 5
  ]).creates,
  [5],
  "two tools settled inside an open response still earn one reply, once it closes",
);
// A settle for a call we never saw is somebody else's event, not a turn.
assert.deepEqual(replay([{ type: "tool.settled", callId: "ghost" }]).creates, []);
// And a duplicate settle does not buy a second reply.
assert.deepEqual(
  replay([
    { type: "tool.called", callId: "c1" },
    { type: "tool.settled", callId: "c1" }, // 1
    { type: "tool.settled", callId: "c1" },
  ]).creates,
  [1],
  "a repeated tool result must not make the agent speak twice",
);
console.log("✓ the floor is taken once per turn, and never after standing down");

// 24. A rejection is a guess, and a wrong guess must not be permanent.
//
// response.rejected infers that something else holds the floor. When that
// inference is wrong no response.done ever arrives, and `active` pinned true
// forever: the watchdog requires !active so it could never fire, and
// isPending() was false, so the seller got silence with not even a spinner. It
// self-healed only when they spoke.
{
  const wedged = replay([
    { type: "reply.wanted" },
    { type: "response.rejected" },
    [{ type: "nudge" }, 60_000],
  ]);
  // 0 is the first ask; 2 is the watchdog recovering from the bad guess.
  assert.deepEqual(
    wedged.creates,
    [0, 2],
    "a rejection that nothing ever settles must not silence the agent forever",
  );

  // The seller sees the wait for as long as it lasts, rather than nothing.
  assert.equal(
    isPending(replay([{ type: "reply.wanted" }, { type: "response.rejected" }]).state),
    true,
    "a guessed-active turn is still a wait, and must show as one",
  );

  // And the distinction holds: a reply that announced itself is still sacred.
  const genuinelySpeaking = replay([
    { type: "reply.wanted" },
    { type: "response.rejected" },
    { type: "response.created" },
    [{ type: "nudge" }, 60_000],
  ]);
  assert.deepEqual(
    genuinelySpeaking.creates,
    [0],
    "once the server says a response is open, the watchdog must stay out of the way",
  );
  console.log("✓ a wrong guess about the floor recovers; a confirmed reply is never cut off");

// 25. Every chapter the seller can reach by voice must have something to ask.
//
// canAskAloud once read `defaultModality !== "form"`, which conflated where a
// seller LANDS with what can be spoken at all. Under that rule none of the 55
// questions in the features chapter were askable — so a seller taking the mic
// affordance there ("not sure about any of these? talk it through instead")
// arrived in a session the agent was forbidden from conducting. An escape
// hatch that leads nowhere is worse than none.
{
  const reachable = CHAPTERS.map((c) => c.id).filter((id) =>
    questionsInChapter(id).some((q) => q.defaultModality !== "agent"),
  );
  for (const chapter of reachable) {
    const askable = questionsInChapter(chapter).filter(
      (q) => q.defaultModality !== "agent" && canAskAloud(q),
    );
    assert.ok(
      askable.length > 0,
      `${chapter} is reachable in voice mode but has nothing the agent may ask`,
    );
  }

  // And the two things that genuinely cannot be spoken still cannot be.
  assert.equal(canAskAloud(resolveQuestion("C.explain")!), false, "a drafted paragraph is read, not recited");
  assert.equal(
    canAskAloud(resolveQuestion("B.components")!),
    false,
    "sixteen components are watched ticking, not held in the head from a list",
  );
  // A short multi-select is still a perfectly good spoken question.
  assert.equal(canAskAloud(resolveQuestion("A.water_heater_type")!), true);
  console.log(`✓ all ${reachable.length} voice-reachable chapters have something the agent may ask`);
}
}

// 23. The hallucination filter cut into real speech.
//
//     "the end", "music", "silence" and "applause" were matched as substrings
//     of the whole turn, so sentences a seller plausibly says were dropped from
//     the transcript they are shown — on the document they are about to sign.
//     They are noise only when they are the entire turn.
for (const real of [
  "We replaced the fence at the end of the driveway in 2020.",
  "There's a music room over the garage.",
  "The pipes make a noise, then silence, then it starts again.",
  "That was the end of it, no more leaks.",
  "There's a silence detector on the alarm, whatever that is.",
]) {
  assert.equal(
    isLikelyHallucination(real),
    false,
    `a sentence is not noise because a noise word is inside it: ${JSON.stringify(real)}`,
  );
}
for (const noise of ["Music", "silence", "The end.", "applause", "[applause]"]) {
  assert.equal(
    isLikelyHallucination(noise),
    true,
    `but on its own it still is: ${JSON.stringify(noise)}`,
  );
}
// And two entries could never fire at all: the comparison strips punctuation
// and underscores before matching, so needles carrying either never matched.
for (const dead of ["amara.org", "BLANK_AUDIO", "blank_audio", "Subtitles by the Amara.org community"]) {
  assert.equal(
    isLikelyHallucination(dead),
    true,
    `${JSON.stringify(dead)} is in the list and must actually match`,
  );
}
console.log("✓ transcriber noise filtered on its own terms, real sentences left alone");

await db.delete(agents).where(eq(agents.id, AGENT_ID));
console.log("\nvoice checks passed\n");
await closeDb();
