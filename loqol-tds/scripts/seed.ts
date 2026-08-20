/**
 * Seeds one agent and two deals: one untouched, one mid-flow.
 *
 * The mid-flow deal is not decoration. It carries all four answer statuses, a
 * voice answer with its verbatim, a follow-up explanation, and a pair of
 * answers that trips a hard conflict rule — so the resume, progress, agent
 * queue, and conflict screens have something real to render from day one
 * instead of an empty database.
 *
 * Re-runnable: deleting the agent cascades to everything below it.
 */

import { eq } from "drizzle-orm";
import { closeDb, db } from "../src/db/index";
import { agents, deals, disclosureRequests, sessions } from "../src/db/schema";
import { writeAnswer, type Actor, type WriteAnswerInput } from "../src/db/answers";
import { hashPassword, hashToken, mintSellerToken } from "../src/db/crypto";
import { agentOnlyQuestions } from "../src/tds/registry";

const AGENT_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const DEAL_FRESH = "dea1aaaa-0000-4000-8000-0000000000a1";
const DEAL_MIDFLOW = "dea1bbbb-0000-4000-8000-0000000000b1";

const DEMO_PASSWORD = "loqol-demo-2026";
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const TTL_DAYS = Number(process.env.SELLER_TOKEN_TTL_DAYS ?? 14);

/** Seed writes go through the same path as the app. A rejection is a bug. */
async function write(input: WriteAnswerInput): Promise<void> {
  const result = await writeAnswer(input);
  if (!result.ok) {
    throw new Error(`seed rejected ${input.questionId}: ${result.reason}`);
  }
}

/**
 * The listing agent fills these before the request goes out. Nobody knows their
 * own legal property description, and opening a seller with one is how you lose
 * them in the first thirty seconds.
 */
async function prefillAgentQuestions(
  dealId: string,
  city: string,
  address: string,
  actor: Actor,
): Promise<void> {
  const values: Record<string, string | boolean | string[]> = {
    "meta.address": address,
    "meta.city": city,
    "meta.county": "Los Angeles",
    "meta.property_description":
      "Lot 14, Block 3, Tract No. 8821, as per map recorded in Book 112, Pages 40-41 of Maps, Los Angeles County Recorder",
    "meta.date": new Date().toISOString().slice(0, 10),
    "meta.multi_unit": false,
    "meta.substituted_disclosures": ["none"],
  };

  for (const q of agentOnlyQuestions()) {
    const value = values[q.id];
    // meta.units is gated on meta.multi_unit and stays unanswered for a SFR.
    if (value === undefined) continue;
    await write({
      dealId,
      questionId: q.id,
      value,
      source: "agent",
      actor,
    });
  }
}

async function createRequest(dealId: string): Promise<{ id: string; token: string }> {
  const token = mintSellerToken();
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86_400_000);

  const [row] = await db
    .insert(disclosureRequests)
    .values({ dealId, tokenHash: hashToken(token), expiresAt })
    .returning({ id: disclosureRequests.id });

  // The only moment the plaintext exists. Everything stored is the hash.
  return { id: row.id, token };
}

async function main(): Promise<void> {
  await db.delete(agents).where(eq(agents.id, AGENT_ID));

  await db.insert(agents).values({
    id: AGENT_ID,
    email: "agent@loqol.test",
    passwordHash: hashPassword(DEMO_PASSWORD),
    name: "Priya Raman",
  });

  const agentActor: Actor = { type: "agent", id: AGENT_ID };

  await db.insert(deals).values([
    {
      id: DEAL_FRESH,
      agentId: AGENT_ID,
      sellerName: "Dana Reyes",
      sellerEmail: "dana.reyes@example.com",
      propertyAddress: "1418 Larkspur Lane, Pasadena, CA 91104",
    },
    {
      id: DEAL_MIDFLOW,
      agentId: AGENT_ID,
      sellerName: "Marcus Oyelaran",
      sellerEmail: "marcus.oyelaran@example.com",
      propertyAddress: "3027 Foothill Boulevard, Glendale, CA 91214",
    },
  ]);

  await prefillAgentQuestions(
    DEAL_FRESH,
    "Pasadena",
    "1418 Larkspur Lane, Pasadena, CA 91104",
    agentActor,
  );
  await prefillAgentQuestions(
    DEAL_MIDFLOW,
    "Glendale",
    "3027 Foothill Boulevard, Glendale, CA 91214",
    agentActor,
  );

  const freshRequest = await createRequest(DEAL_FRESH);
  const midflowRequest = await createRequest(DEAL_MIDFLOW);

  // The seller is identified by their disclosure request, not by an account.
  const sellerActor: Actor = { type: "seller", id: midflowRequest.id };
  const form = { source: "form", actor: sellerActor } as const;

  for (const [questionId, value] of [
    ["occupancy", "is"],
    ["A.range", true],
    ["A.oven", true],
    ["A.microwave", true],
    ["A.dishwasher", true],
    ["A.garbage_disposal", true],
    ["A.central_heating", true],
    ["A.central_ac", false],
    ["A.smoke_detectors", true],
    ["A.co_device", true],
    ["A.rain_gutters", true],
    ["A.public_sewer", true],
    // With A.public_sewer above, this trips the `sewer_and_septic` hard rule.
    ["A.septic_tank", true],
    // And this one trips `flooding_no_but_sump_pump` as a soft rule.
    ["A.sump_pump", true],
    ["A.pool", false],
    ["A.garage", true],
    ["A.garage_type", "attached"],
    ["A.auto_garage_opener", true],
    ["A.remote_count", 2],
  ] as const) {
    await write({ dealId: DEAL_MIDFLOW, questionId, value, ...form });
  }

  // A closed enum a lot of homeowners genuinely cannot answer. Not a failure —
  // it routes to the agent's queue, which is what the agent view is for.
  await write({
    dealId: DEAL_MIDFLOW,
    questionId: "A.water_heater_type",
    value: null,
    status: "unknown",
    note: "Seller couldn't tell gas from electric; agent to check the label.",
    ...form,
  });

  // "Come back to it" has to actually mean something. deferredQuestions()
  // brings this back at the end rather than blocking here.
  await write({
    dealId: DEAL_MIDFLOW,
    questionId: "A.roof",
    value: null,
    status: "skipped",
    ...form,
  });

  const voice = { source: "voice", actor: sellerActor } as const;

  await write({
    dealId: DEAL_MIDFLOW,
    questionId: "C.8",
    value: false,
    confidence: 0.92,
    verbatim: "No, nothing like that, the yard's always been dry.",
    ...voice,
  });
  await write({
    dealId: DEAL_MIDFLOW,
    questionId: "C.12",
    value: false,
    confidence: 0.81,
    verbatim: "CC and Rs — I don't think so? Nobody's ever sent me any.",
    ...voice,
  });
  // C.13 yes with C.12 no trips the `hoa_without_ccrs` hard rule.
  await write({
    dealId: DEAL_MIDFLOW,
    questionId: "C.13",
    value: true,
    confidence: 0.9,
    verbatim: "Yeah there's an HOA, Foothill Terrace something.",
    ...voice,
  });
  // Synthesised follow-up — captured while the seller still has it in mind.
  await write({
    dealId: DEAL_MIDFLOW,
    questionId: "C.13.explanation",
    value:
      "Foothill Terrace Homeowners Association. Dues are about $240 a month.",
    verbatim: "Foothill Terrace. It's like two forty a month I think.",
    confidence: 0.85,
    ...voice,
  });

  // Explained, still wanted a human. That's allowed, and it's not a defect.
  await write({
    dealId: DEAL_MIDFLOW,
    questionId: "C.4",
    value: null,
    status: "flagged_for_agent",
    note: "Previous owner converted the garage; seller unsure about permits.",
    ...voice,
  });

  await db.insert(sessions).values([
    { dealId: DEAL_FRESH, modality: "form" },
    { dealId: DEAL_MIDFLOW, modality: "voice" },
  ]);

  console.log(`\nAgent login   ${"agent@loqol.test"} / ${DEMO_PASSWORD}`);
  console.log(`\nMagic links (plaintext token shown once, only the hash is stored):`);
  console.log(`  Dana Reyes (not started)  ${APP_URL}/s/${freshRequest.token}`);
  console.log(`  Marcus Oyelaran (mid-flow) ${APP_URL}/s/${midflowRequest.token}`);
  console.log(`\nLinks expire in ${TTL_DAYS} days.\n`);
}

main()
  .then(closeDb)
  .catch(async (error) => {
    console.error(error);
    await closeDb();
    process.exit(1);
  });
