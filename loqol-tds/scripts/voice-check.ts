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
import { agentQueue } from "../src/tds/flow";
import { voiceInstructions } from "../src/tds/voice";
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

// 8. The instructions carry the rules that keep this honest.
const prompt = voiceInstructions("awareness", "Marcus");
for (const [label, pattern] of [
  ["never invent facts", /never write down a fact the seller did not say/i],
  ["unknown vs not aware", /not aware of any/i],
  ["no legal advice", /not a lawyer/i],
  ["no pushback on switching", /do not talk them out of it/i],
  ["server owns the order", /you do not decide what comes next/i],
] as const) {
  assert.match(prompt, pattern, `system prompt must state: ${label}`);
}
assert.match(prompt, /C\.13/, "the brief must carry the actual questions");
console.log("✓ system prompt states every rule that keeps this honest");

await db.delete(agents).where(eq(agents.id, AGENT_ID));
console.log("\nvoice checks passed\n");
await closeDb();
