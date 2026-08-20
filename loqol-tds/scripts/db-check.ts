/**
 * Self-check for the persistence layer. Runs against a scratch deal it creates
 * and deletes, so it is safe to run against the seeded database.
 *
 * The thing actually being asserted is that the DB round-trip preserves the
 * AnswerMap contract — everything in src/tds/ is a pure function of that map,
 * so if it survives a write and a read, the flow engine keeps working.
 */

import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "../src/db/index";
import { agents, answerEvents, answers, deals } from "../src/db/schema";
import { answerHistory, loadAnswers, writeAnswer, type Actor } from "../src/db/answers";
import { hashPassword, hashToken, mintSellerToken, verifyPassword } from "../src/db/crypto";
import { agentQueue, nextQuestion, progress } from "../src/tds/flow";

const AGENT_ID = "cccccccc-0000-4000-8000-000000000001";
const DEAL_ID = "cccccccc-0000-4000-8000-0000000000c1";
const actor: Actor = { type: "seller", id: "db-check" };

async function countAnswers(questionId: string): Promise<number> {
  const rows = await db
    .select()
    .from(answers)
    .where(and(eq(answers.dealId, DEAL_ID), eq(answers.questionId, questionId)));
  return rows.length;
}

async function setup(): Promise<void> {
  await db.delete(agents).where(eq(agents.id, AGENT_ID));
  await db.insert(agents).values({
    id: AGENT_ID,
    email: "db-check@loqol.test",
    passwordHash: hashPassword("scratch"),
    name: "db-check",
  });
  await db.insert(deals).values({
    id: DEAL_ID,
    agentId: AGENT_ID,
    sellerName: "Scratch",
    sellerEmail: "scratch@loqol.test",
    propertyAddress: "nowhere",
  });
}

async function main(): Promise<void> {
  await setup();

  // 1. Current state is upserted; history is appended. Two writes to the same
  //    question must leave one answer row and two audit rows.
  await writeAnswer({ dealId: DEAL_ID, questionId: "A.pool", value: false, source: "form", actor });
  await writeAnswer({ dealId: DEAL_ID, questionId: "A.pool", value: true, source: "form", actor });

  assert.equal(await countAnswers("A.pool"), 1, "upsert should not duplicate the answer row");
  const history = await answerHistory(DEAL_ID, "A.pool");
  assert.equal(history.length, 2, "every mutation needs an audit row");
  assert.deepEqual(
    history.map((h) => h.value),
    [false, true],
    "audit trail must preserve the earlier answer, not just the latest",
  );
  console.log("✓ upsert updates state, audit appends history");

  // 2. A low-confidence voice write is rejected and leaves no trace. The voice
  //    agent re-asks rather than guessing.
  const lowConfidence = await writeAnswer({
    dealId: DEAL_ID,
    questionId: "C.7",
    value: true,
    confidence: 0.4,
    source: "voice",
    actor,
  });
  assert.equal(lowConfidence.ok, false, "confidence below threshold must be rejected");
  assert.equal(await countAnswers("C.7"), 0, "a rejected write must not persist");

  const wrongType = await writeAnswer({
    dealId: DEAL_ID,
    questionId: "A.pool",
    value: "maybe",
    source: "voice",
    actor,
  });
  assert.equal(wrongType.ok, false, "a string is not a valid boolean answer");
  console.log("✓ invalid writes rejected without persisting");

  // 3. "I don't know" is an answer, not a validation failure — it carries a
  //    null value that the type check would reject, so it skips validation and
  //    routes to the agent queue instead.
  const unknown = await writeAnswer({
    dealId: DEAL_ID,
    questionId: "A.water_heater_type",
    value: null,
    status: "unknown",
    source: "form",
    actor,
  });
  assert.equal(unknown.ok, true, '"I don\'t know" must be writable');

  const flagged = await writeAnswer({
    dealId: DEAL_ID,
    questionId: "C.4",
    value: null,
    status: "flagged_for_agent",
    source: "voice",
    actor,
  });
  assert.equal(flagged.ok, true, "flag-for-agent must be writable");
  console.log("✓ unknown and flagged statuses persist without type validation");

  // 4. Follow-ups are synthesised, not in QUESTIONS. Writing one has to work or
  //    the voice agent's record_explanation tool fails on every yes.
  await writeAnswer({ dealId: DEAL_ID, questionId: "C.13", value: true, source: "voice", actor });
  const explanation = await writeAnswer({
    dealId: DEAL_ID,
    questionId: "C.13.explanation",
    value: "Foothill Terrace HOA, about $240 a month.",
    source: "voice",
    actor,
  });
  assert.equal(explanation.ok, true, "synthesised follow-ups must be writable");
  console.log("✓ synthesised follow-up explanations persist");

  // 5. The contract that matters: what comes back out of the database drives
  //    the flow engine identically to an in-memory map.
  const map = await loadAnswers(DEAL_ID);
  assert.equal(map["A.pool"].value, true, "latest value wins on read");
  assert.equal(map["A.water_heater_type"].status, "unknown");

  const queue = agentQueue(map).map((q) => q.id);
  assert.ok(queue.includes("A.water_heater_type"), "unknowns route to the agent");
  assert.ok(queue.includes("C.4"), "flagged questions route to the agent");

  const p = progress(map);
  assert.ok(p.overallPercent > 0, "progress must reflect persisted answers");
  assert.match(p.label, /minute/, "progress speaks in minutes, not field counts");

  await db
    .delete(answers)
    .where(and(eq(answers.dealId, DEAL_ID), eq(answers.questionId, "C.13.explanation")));
  const withoutExplanation = await loadAnswers(DEAL_ID);
  assert.equal(
    nextQuestion(withoutExplanation, "C.13").question?.id,
    "C.13.explanation",
    "a yes must pull its follow-up to the front, straight off the database",
  );
  console.log("✓ AnswerMap round-trips: agent queue, progress, and follow-up ordering");

  // 6. Credentials.
  const hash = hashPassword("correct horse");
  assert.equal(verifyPassword("correct horse", hash), true);
  assert.equal(verifyPassword("wrong horse", hash), false);
  assert.equal(verifyPassword("correct horse", "garbage"), false);

  const token = mintSellerToken();
  assert.equal(hashToken(token), hashToken(token), "token hashing is deterministic");
  assert.notEqual(hashToken(token), token, "the token itself must never be the stored value");
  assert.notEqual(mintSellerToken(), mintSellerToken(), "tokens must be unique");
  console.log("✓ password verification and token hashing");

  const events = await db.select().from(answerEvents).where(eq(answerEvents.dealId, DEAL_ID));
  const state = await db.select().from(answers).where(eq(answers.dealId, DEAL_ID));
  console.log(`\n${state.length} answer rows, ${events.length} audit rows on the scratch deal.`);

  await db.delete(agents).where(eq(agents.id, AGENT_ID));
  console.log("all checks passed\n");
}

main()
  .then(closeDb)
  .catch(async (error) => {
    console.error(error);
    await closeDb();
    process.exit(1);
  });
