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
import { agents, answerEvents, answers, deals, disclosureRequests } from "../src/db/schema";
import { answerHistory, loadAnswers, writeAnswer, type Actor } from "../src/db/answers";
import { hashPassword, hashToken, mintSellerToken, verifyPassword } from "../src/db/crypto";
import { authenticate, issueSession, readSession } from "../src/db/auth";
import {
  resolveSellerRequest,
  resolveSellerToken,
  resendSellerLink,
} from "../src/db/requests";
import {
  issueSellerSession,
  readSellerSession,
  sessionCookie,
} from "../src/db/seller-auth";
import { clearOutbox, recentEmails } from "../src/mail/send";
import {
  clearAccountAttempts,
  clearLoginAttempts,
  recordAccountAttempt,
  recordLoginAttempt,
} from "../src/db/rate-limit";
import {
  latestSigning,
  recordCompletion,
  signingParties,
  signingStatus,
} from "../src/db/signings";
import { agentQueue, nextQuestion, progress } from "../src/tds/flow";
import { detectConflicts } from "../src/tds/conflicts";
import {
  acknowledgeConflict,
  reviewConflicts,
  unacknowledgeConflict,
} from "../src/db/conflicts";
import { agentTokens } from "../src/db/schema";
import { requestPasswordReset, signUp } from "../src/db/account-flows";
import { changePassword, passwordMatches } from "../src/db/accounts";
import {
  TOKEN_TTL_MINUTES,
  issueAgentToken,
  redeemAgentToken,
  resolveAgentToken,
} from "../src/db/agent-tokens";
import { MIN_PASSWORD_LENGTH, passwordProblem } from "../src/app/password-rules";

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

  // 7. Conflicts: detected, acknowledgeable, and never destructive.
  await writeAnswer({ dealId: DEAL_ID, questionId: "C.12", value: false, source: "voice", actor });
  const withClash = await loadAnswers(DEAL_ID);
  const found = detectConflicts(withClash);
  const hoa = found.find((c) => c.ruleId === "hoa_without_ccrs");
  assert.ok(hoa, "an HOA with no CC&Rs must be detected");
  assert.equal(hoa.severity, "hard");
  assert.deepEqual(
    found.map((c) => c.severity),
    [...found.map((c) => c.severity)].sort((a, b) => (a === b ? 0 : a === "hard" ? -1 : 1)),
    "hard conflicts must sort first",
  );
  assert.doesNotMatch(
    hoa.message,
    /\berror\b|\bwrong\b|\bincorrect\b|\bmistake\b/i,
    "never tell the seller they made an error",
  );

  let reviewed = await reviewConflicts(DEAL_ID, withClash);
  assert.equal(reviewed.find((c) => c.ruleId === "hoa_without_ccrs")?.acknowledged, false);

  await acknowledgeConflict(DEAL_ID, "hoa_without_ccrs", actor, "It's a small association, no recorded CC&Rs.");
  reviewed = await reviewConflicts(DEAL_ID, await loadAnswers(DEAL_ID));
  const acked = reviewed.find((c) => c.ruleId === "hoa_without_ccrs");
  assert.equal(acked?.acknowledged, true, "standing by a conflict must persist");
  // Acknowledging settles the question, it does not edit the answers. The
  // seller's contradiction stays visible to their agent.
  assert.equal((await loadAnswers(DEAL_ID))["C.12"].value, false, "acknowledging must not rewrite an answer");
  assert.ok(
    detectConflicts(await loadAnswers(DEAL_ID)).some((c) => c.ruleId === "hoa_without_ccrs"),
    "the conflict itself must still be detectable for the agent",
  );

  await unacknowledgeConflict(DEAL_ID, "hoa_without_ccrs");
  reviewed = await reviewConflicts(DEAL_ID, await loadAnswers(DEAL_ID));
  assert.equal(reviewed.find((c) => c.ruleId === "hoa_without_ccrs")?.acknowledged, false, "changing their mind must work");
  console.log("✓ conflicts detected, acknowledgeable, and never auto-corrected");

  // 8. Login must not leak which emails exist — by message OR by clock.
  const missAt = performance.now();
  assert.equal(await authenticate("nobody-here@loqol.test", "whatever"), null);
  const missMs = performance.now() - missAt;

  const wrongAt = performance.now();
  assert.equal(await authenticate("db-check@loqol.test", "whatever"), null);
  const wrongMs = performance.now() - wrongAt;

  // An early return on a missing row skips scrypt entirely, which is a
  // measurable oracle. Both paths must pay for one hash.
  const ratio = Math.max(missMs, wrongMs) / Math.max(1, Math.min(missMs, wrongMs));
  assert.ok(
    ratio < 3,
    `unknown-email and wrong-password must take comparable time (was ${ratio.toFixed(1)}x)`,
  );
  // And the right password still works, so the decoy hash has not broken login.
  const good = await authenticate("db-check@loqol.test", "scratch");
  assert.ok(good, "a correct password must still authenticate");
  assert.equal(good.email, "db-check@loqol.test");
  console.log("✓ login reveals nothing by message or by timing");

  // 9. Throttling is a cooldown, never a lock — a lock on a known email is a
  //    free denial-of-service against that agent.
  const victim = "throttle-check@loqol.test";
  let verdict = { ok: true, retryAfterSeconds: 0 };
  for (let i = 0; i < 6; i++) verdict = recordLoginAttempt(victim, "203.0.113.7");
  assert.equal(verdict.ok, false, "the sixth attempt in the window must be refused");
  assert.ok(verdict.retryAfterSeconds > 0, "refusal must name when they can retry");
  assert.ok(verdict.retryAfterSeconds <= 900, "and it must expire, not persist");
  assert.equal(
    recordLoginAttempt("someone-else@loqol.test", "198.51.100.4").ok,
    true,
    "one throttled email must not throttle another",
  );
  clearLoginAttempts(victim);
  assert.equal(
    recordLoginAttempt(victim, "203.0.113.7").ok,
    true,
    "a correct password clears the budget",
  );
  console.log("✓ login throttling is a per-email cooldown, cleared on success");


  // 10. Seller access. Five outcomes, because there are five things that can
  //     have happened and a seller told the wrong one has no working next step.
  const DEAL_B = "cccccccc-0000-4000-8000-0000000000c2";
  await db.insert(deals).values({
    id: DEAL_B,
    agentId: AGENT_ID,
    sellerName: "Scratch Two",
    sellerEmail: "scratch.two@loqol.test",
    propertyAddress: "elsewhere",
    submittedAt: new Date(),
  });

  const inSevenDays = () => new Date(Date.now() + 7 * 86_400_000);
  const yesterday = () => new Date(Date.now() - 86_400_000);

  async function issueRaw(
    dealId: string,
    opts: { expiresAt: Date; revokedAt?: Date },
  ): Promise<{ token: string; requestId: string }> {
    const token = mintSellerToken();
    const [row] = await db
      .insert(disclosureRequests)
      .values({
        dealId,
        tokenHash: hashToken(token),
        expiresAt: opts.expiresAt,
        revokedAt: opts.revokedAt ?? null,
      })
      .returning({ id: disclosureRequests.id });
    return { token, requestId: row.id };
  }

  const live = await issueRaw(DEAL_ID, { expiresAt: inSevenDays() });
  const stale = await issueRaw(DEAL_ID, { expiresAt: yesterday() });
  const killed = await issueRaw(DEAL_ID, { expiresAt: inSevenDays(), revokedAt: new Date() });
  const signed = await issueRaw(DEAL_B, { expiresAt: inSevenDays() });
  const signedStale = await issueRaw(DEAL_B, { expiresAt: yesterday() });
  const signedKilled = await issueRaw(DEAL_B, { expiresAt: inSevenDays(), revokedAt: new Date() });

  assert.equal((await resolveSellerToken(live.token)).outcome, "valid");
  assert.equal((await resolveSellerToken(stale.token)).outcome, "expired");
  assert.equal((await resolveSellerToken(killed.token)).outcome, "revoked");
  assert.equal((await resolveSellerToken(signed.token)).outcome, "submitted");
  assert.equal(
    (await resolveSellerToken(mintSellerToken())).outcome,
    "not_found",
    "an unknown token is not an expired one",
  );

  // Precedence, and both halves of it are a product decision.
  assert.equal(
    (await resolveSellerToken(signedStale.token)).outcome,
    "submitted",
    "a finished disclosure shows what they signed rather than an expiry notice",
  );
  assert.equal(
    (await resolveSellerToken(signedKilled.token)).outcome,
    "revoked",
    "revocation is a deliberate act and outranks everything, submission included",
  );

  // Malformed and unknown must be one answer. Telling a guesser when they had
  // the shape right is the only thing a 256-bit token can leak.
  for (const bad of ["", "not-a-token", live.token.slice(0, 20), "x".repeat(600)]) {
    assert.equal(
      (await resolveSellerToken(bad)).outcome,
      "not_found",
      "a mangled token and an unknown one must be indistinguishable",
    );
  }

  // A refusal must not hand back the seller's name or address on the way out.
  const refused = await resolveSellerToken(stale.token);
  assert.ok(!("session" in refused), "an expired link must carry no seller detail");
  assert.equal(JSON.stringify(refused).includes("Scratch"), false);
  console.log("✓ five seller outcomes, distinguished, and none of them leaks");

  // 11. The session cookie. A handle to one disclosure request, and nothing a
  //     guesser or an agent guard can make anything else of.
  const valid = await resolveSellerToken(live.token);
  assert.ok(valid.outcome === "valid");
  const jar = sessionCookie(valid.session);

  const claim = readSellerSession(jar.value);
  assert.ok(claim, "a freshly minted cookie must verify");
  assert.equal(claim.requestId, live.requestId);
  assert.equal(claim.dealId, DEAL_ID);

  // Tampering. Every field is inside the MAC, so nothing survives an edit.
  const [tag, reqId, dealId, expires, mac] = jar.value.split(".");
  const tampered: Array<[string, string]> = [
    ["a different deal", [tag, reqId, DEAL_B, expires, mac].join(".")],
    ["a different request", [tag, signed.requestId, dealId, expires, mac].join(".")],
    ["a longer life", [tag, reqId, dealId, String(Number(expires) + 86_400), mac].join(".")],
    ["a forged signature", [tag, reqId, dealId, expires, "x".repeat(mac.length)].join(".")],
    ["a truncated cookie", [tag, reqId, dealId, expires].join(".")],
    ["a re-tagged cookie", ["s2", reqId, dealId, expires, mac].join(".")],
  ];
  for (const [what, value] of tampered) {
    assert.equal(readSellerSession(value), null, `${what} must be rejected`);
  }

  // Roles cannot be crossed. Different cookie name, different arity, and —
  // the part that actually matters — a different string under the HMAC, so a
  // signature minted for one role does not verify for the other.
  const agentJar = issueSession(AGENT_ID);
  assert.equal(
    readSession(jar.value),
    null,
    "a seller cookie must never satisfy the agent guard",
  );
  assert.equal(
    readSellerSession(agentJar.value),
    null,
    "an agent cookie must never satisfy the seller guard",
  );
  assert.equal(
    agentJar.value.split(".").length,
    3,
    "the agent cookie is three parts; the seller cookie is five, so neither parses as the other",
  );
  assert.equal(jar.value.split(".").length, 5);

  // Scoping. The deal a cookie can reach is the one signed into it; there is no
  // parameter anywhere downstream that could name another.
  const resolvedA = await resolveSellerRequest(claim.requestId);
  assert.ok("session" in resolvedA && resolvedA.session.dealId === DEAL_ID);
  const resolvedB = await resolveSellerRequest(signed.requestId);
  assert.ok("session" in resolvedB && resolvedB.session.dealId === DEAL_B);
  assert.notEqual(
    claim.requestId,
    signed.requestId,
    "deal A's cookie names deal A's request and only that",
  );

  // A dead link still gets a handle, so the help page can say which kind of
  // dead — and the handle grants nothing, because the database is re-read.
  assert.equal((await resolveSellerRequest(stale.requestId)).outcome, "expired");
  assert.equal((await resolveSellerRequest(killed.requestId)).outcome, "revoked");
  assert.equal((await resolveSellerRequest("not-a-uuid")).outcome, "not_found");

  // And the cookie can never be the reason a link outlives its own expiry.
  const twoDays = new Date(Date.now() + 2 * 86_400_000);
  assert.ok(
    issueSellerSession({ requestId: live.requestId, dealId: DEAL_ID }, twoDays).maxAge <=
      2 * 86_400,
    "the cookie must not outlive the link it was traded for",
  );
  console.log("✓ seller cookie: scoped to one deal, unforgeable, and not an agent");

  // 12. "Send me a new link" — the seller's own way out of a dead link.
  clearOutbox();
  const resent = await resendSellerLink(stale.requestId, "https://example.test");
  assert.ok(resent, "a stale request must be reissuable");
  assert.match(resent.sentTo, /@loqol\.test$/, "the seller is told which inbox, masked");
  assert.equal(resent.sentTo.includes("scratch@"), false, "and not the whole address");

  // The old link is dead and a live one exists in its place.
  assert.equal(
    (await resolveSellerToken(live.token)).outcome,
    "revoked",
    "reissuing must revoke every earlier link for the deal",
  );

  const sentMail = recentEmails();
  const toSeller = sentMail.find((m) => m.to === "scratch@loqol.test");
  const toAgent = sentMail.find((m) => m.to === "db-check@loqol.test");
  assert.ok(toSeller, "the new link goes to the address on the deal");
  assert.match(toSeller.body, /https:\/\/example\.test\/s\//, "and it is a real link");
  assert.ok(toAgent, "the agent is told their seller was locked out");
  assert.equal(
    toAgent.body.includes("/s/"),
    false,
    "but never sent the token — a bearer credential in a second inbox is twice the exposure",
  );
  console.log("✓ a dead link reissues to the seller's inbox, and only theirs");


  // 10. Signing up must not reveal whether an address already has an account.
  //     Not by message, not by status, not by clock — the same argument as
  //     check 8, one door further along.
  const NEW_EMAIL = "signup-check@loqol.test";
  const ORIGIN = "https://loqol.test";
  const FIRST_PASSWORD = "correct horse battery";
  await db.delete(agents).where(eq(agents.email, NEW_EMAIL));
  clearOutbox();

  const freshAt = performance.now();
  const nothing = await signUp(
    { email: NEW_EMAIL, name: "Signup Check", password: FIRST_PASSWORD },
    ORIGIN,
  );
  const freshMs = performance.now() - freshAt;

  // The flow returns void on purpose: a route cannot leak what it is not given.
  assert.equal(nothing, undefined, "signUp must hand its caller nothing to branch on");

  const [created] = await db.select().from(agents).where(eq(agents.email, NEW_EMAIL));
  assert.ok(created, "a free address must actually create the account");
  assert.equal(recentEmails().length, 1, "signup sends exactly one message");
  assert.equal(recentEmails()[0].to, NEW_EMAIL);
  assert.match(
    recentEmails()[0].body,
    /\/agent\/sign-in\//,
    "a new account is emailed a one-time sign-in link",
  );

  clearOutbox();
  const takenAt = performance.now();
  // Same address, different case, different name, different password.
  await signUp(
    { email: NEW_EMAIL.toUpperCase(), name: "Impostor", password: "something else entirely" },
    ORIGIN,
  );
  const takenMs = performance.now() - takenAt;

  const existing = await db.select().from(agents).where(eq(agents.email, NEW_EMAIL));
  assert.equal(existing.length, 1, "a taken address must not create a second account");
  assert.equal(existing[0].name, "Signup Check", "nor overwrite the account already there");
  assert.equal(existing[0].passwordHash, created.passwordHash, "nor its password");

  assert.equal(recentEmails().length, 1, "the collision branch still sends exactly one message");
  assert.equal(
    recentEmails()[0].to,
    NEW_EMAIL,
    "addressed to the account owner — the requester may not be them",
  );
  assert.doesNotMatch(
    recentEmails()[0].body,
    /\/agent\/sign-in\//,
    "and carries nothing that would sign the requester in",
  );

  // Both branches pay for one scrypt (registerAgent hashes before it inserts),
  // so a stopwatch cannot separate them either.
  const signupRatio =
    Math.max(freshMs, takenMs) / Math.max(1, Math.min(freshMs, takenMs));
  assert.ok(
    signupRatio < 3,
    `signup branches must take comparable time (was ${signupRatio.toFixed(1)}x)`,
  );
  console.log("✓ signup reveals nothing — same return, same work, mail to the owner");

  // 11. Length is the only password rule. Composition rules push people toward
  //     shorter, more predictable passwords.
  assert.ok(passwordProblem("short"), "a too-short password is refused");
  assert.equal(passwordProblem("x".repeat(MIN_PASSWORD_LENGTH)), null, "length is the rule");
  assert.equal(
    passwordProblem("four words with no digits"),
    null,
    "no digit, case or symbol requirements",
  );
  console.log("✓ password rules are length and nothing else");

  // 12. Reset links: unknown addresses are indistinguishable, and a real one is
  //     stored hashed, expires, and works exactly once.
  const agentId = created.id;
  clearOutbox();
  const tokensBefore = (await db.select().from(agentTokens)).length;
  await requestPasswordReset("nobody-at-all@loqol.test", ORIGIN);
  assert.equal(recentEmails().length, 0, "an address with no account is mailed nothing");
  assert.equal(
    (await db.select().from(agentTokens)).length,
    tokensBefore,
    "and mints no token, so there is no side effect to observe either",
  );

  await requestPasswordReset(NEW_EMAIL, ORIGIN);
  assert.equal(recentEmails().length, 1, "a known address is mailed a link");
  const resetToken = recentEmails()[0].body.match(/\/agent\/reset-password\/(\S+)/)?.[1];
  assert.ok(resetToken, "the reset email must carry a token");

  const [stored] = await db
    .select()
    .from(agentTokens)
    .where(and(eq(agentTokens.agentId, agentId), eq(agentTokens.purpose, "password_reset")));
  assert.notEqual(stored.tokenHash, resetToken, "the token itself is never what we store");
  assert.equal(stored.tokenHash, hashToken(resetToken), "what we store is its SHA-256");
  assert.ok(stored.expiresAt.getTime() > Date.now(), "issued live");
  assert.ok(
    stored.expiresAt.getTime() - Date.now() <= TOKEN_TTL_MINUTES * 60_000 + 5_000,
    "and short-lived — a reset link is a bearer credential sitting in a mailbox",
  );

  assert.ok(await redeemAgentToken(resetToken, "password_reset"), "the link works once");
  assert.equal(await redeemAgentToken(resetToken, "password_reset"), null, "and never twice");
  assert.equal(
    await resolveAgentToken(resetToken, "password_reset"),
    null,
    "a spent link does not even resolve",
  );

  // A sign-in link is not a reset link. Same table, different door.
  const signInToken = await issueAgentToken(agentId, "sign_in");
  assert.equal(
    await redeemAgentToken(signInToken, "password_reset"),
    null,
    "a sign-in link must not double as a password reset",
  );
  assert.ok(await redeemAgentToken(signInToken, "sign_in"), "it still opens its own door");

  const staleReset = mintSellerToken();
  await db.insert(agentTokens).values({
    agentId,
    purpose: "password_reset",
    tokenHash: hashToken(staleReset),
    expiresAt: new Date(Date.now() - 60_000),
  });
  assert.equal(
    await resolveAgentToken(staleReset, "password_reset"),
    null,
    "an expired link is not a link",
  );
  assert.equal(await redeemAgentToken(staleReset, "password_reset"), null, "and cannot be spent");
  console.log("✓ reset links are hashed, single-use, and expire");

  // 13. Changing the password cancels every outstanding link. A reset email
  //     that still works afterwards is a spare key to the account.
  const linkA = await issueAgentToken(agentId, "password_reset");
  const linkB = await issueAgentToken(agentId, "password_reset");
  await changePassword(agentId, "a brand new passphrase");
  assert.equal(await resolveAgentToken(linkA, "password_reset"), null, "outstanding links die");
  assert.equal(await resolveAgentToken(linkB, "password_reset"), null, "all of them, not just the last");
  assert.equal(await passwordMatches(agentId, "a brand new passphrase"), true, "the new one works");
  assert.equal(await passwordMatches(agentId, FIRST_PASSWORD), false, "the old one stops");
  console.log("✓ changing a password invalidates outstanding reset tokens");

  // 14. The mail-sending endpoints are throttled per address, per action. An
  //     unlimited reset endpoint is a mail bomb aimed at whoever it names.
  const target = "mailbomb-check@loqol.test";
  let slow = { ok: true, retryAfterSeconds: 0 };
  for (let i = 0; i < 4; i++) slow = recordAccountAttempt("reset-request", target, "203.0.113.9");
  assert.equal(slow.ok, false, "the fourth reset request in the window is refused");
  assert.ok(slow.retryAfterSeconds > 0, "and it says when they can retry");
  assert.equal(
    recordAccountAttempt("signup", target, "203.0.113.9").ok,
    true,
    "spending the reset budget must not lock the same address out of signup",
  );
  clearAccountAttempts("reset-request", target);
  clearAccountAttempts("signup", target);
  console.log("✓ signup and reset are throttled per address and per action");

  // Cascades to the tokens.
  await db.delete(agents).where(eq(agents.email, NEW_EMAIL));

  // Signing state, which is derived like every other status in this codebase.
  // A deal with no submission is "unsent" — not an error, and not a null the
  // caller has to remember to handle.
  const fresh = await signingStatus(DEAL_ID);
  assert.equal(fresh.state, "unsent", "a deal that was never sent to sign is unsent");
  assert.equal(await latestSigning(DEAL_ID), null);

  // A webhook that names a submission we never created must be ignored rather
  // than trusted. It is the one message on this system an outsider can attempt.
  const stray = await recordCompletion(999_999_999, new Date());
  assert.equal(stray, null, "completion for an unknown submission must be ignored");

  // And the parties come from the deal, never from the request — nothing a
  // caller sends can redirect who is asked to sign, or where the copy goes.
  const parties = await signingParties(DEAL_ID);
  assert.ok(parties, "a deal must resolve its own signers");
  assert.equal(parties.sellerEmail, "scratch@loqol.test");
  assert.equal(parties.agentName, "db-check");
  console.log("✓ signing state derived, strays ignored, parties come from the deal");

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
