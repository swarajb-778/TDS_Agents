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
  NUDGE_AFTER_MS,
  isActiveResponseClash,
  isPending,
  replay,
} from "../src/tds/voice-turns";
import { POST as toolRoute } from "../src/app/api/voice/tool/route";

const AGENT_ID = "eeeeeeee-0000-4000-8000-000000000001";
const DEAL_ID = "eeeeeeee-0000-4000-8000-0000000000e1";
const TOKEN = "voice-check-token";

async function call(name: string, args: Record<string, unknown>) {
  const res = await toolRoute(
    new Request("http://local/api/voice/tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TOKEN, name, args }),
    }),
  );
  return (await res.json()) as Record<string, unknown>;
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
  await db.insert(disclosureRequests).values({
    dealId: DEAL_ID,
    tokenHash: hashToken(TOKEN),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
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

await db.delete(agents).where(eq(agents.id, AGENT_ID));
console.log("\nvoice checks passed\n");
await closeDb();
