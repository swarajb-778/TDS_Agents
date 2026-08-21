/**
 * The agent's view of their deals.
 *
 * Status is derived, not stored: "not started" versus "in progress" is a
 * function of the answers, and only submission is a real event. A status column
 * would be a second source of truth that can disagree with what it summarises.
 */

import { desc, eq, inArray } from "drizzle-orm";
import { db } from "./index";
import { agents, answers, deals, disclosureRequests } from "./schema";
import { hashToken, mintSellerToken } from "./crypto";
import { agentQueue, deferredQuestions, progress } from "../tds/flow";
import { detectConflicts } from "../tds/conflicts";
import type { AnswerMap } from "../tds/types";

export type DealStatus = "draft" | "not_started" | "in_progress" | "submitted";

export interface DealSummary {
  id: string;
  sellerName: string;
  sellerEmail: string;
  propertyAddress: string;
  status: DealStatus;
  percent: number;
  /** Questions the seller could not answer — the agent's actual work queue. */
  needsAgent: number;
  conflicts: number;
  linkSent: boolean;
  linkExpiresAt: Date | null;
  updatedAt: Date;
}

function statusOf(
  answers: AnswerMap,
  submittedAt: Date | null,
  hasRequest: boolean,
): DealStatus {
  if (submittedAt) return "submitted";
  if (!hasRequest) return "draft";
  // Agent-prefilled answers do not count as the seller having started.
  const bySeller = Object.values(answers).some((a) => a.source !== "agent");
  return bySeller ? "in_progress" : "not_started";
}

/**
 * Three queries total, not three per deal.
 *
 * The obvious shape here — loadAnswers() inside the map — is an N+1: an agent
 * with fifty sellers would open a hundred round trips against a pool of five.
 * Everything is fetched in bulk and grouped in memory instead.
 */
export async function listDeals(agentId: string): Promise<DealSummary[]> {
  const rows = await db
    .select()
    .from(deals)
    .where(eq(deals.agentId, agentId))
    .orderBy(desc(deals.updatedAt));

  if (rows.length === 0) return [];
  const dealIds = rows.map((d) => d.id);

  const [answerRows, requestRows] = await Promise.all([
    db.select().from(answers).where(inArray(answers.dealId, dealIds)),
    db
      .select()
      .from(disclosureRequests)
      .where(inArray(disclosureRequests.dealId, dealIds))
      .orderBy(desc(disclosureRequests.sentAt)),
  ]);

  const answersByDeal = new Map<string, AnswerMap>();
  for (const row of answerRows) {
    const map = answersByDeal.get(row.dealId) ?? {};
    map[row.questionId] = {
      questionId: row.questionId,
      value: row.value ?? null,
      status: row.status,
      source: row.source,
      confidence: row.confidence ?? undefined,
      verbatim: row.verbatim ?? undefined,
      note: row.note ?? undefined,
      updatedAt: row.updatedAt.toISOString(),
    };
    answersByDeal.set(row.dealId, map);
  }

  return rows.map((deal) => {
      const answers = answersByDeal.get(deal.id) ?? {};
      const live = requestRows.find((r) => r.dealId === deal.id && !r.revokedAt);
      return {
        id: deal.id,
        sellerName: deal.sellerName,
        sellerEmail: deal.sellerEmail,
        propertyAddress: deal.propertyAddress,
        status: statusOf(answers, deal.submittedAt, Boolean(live)),
        percent: progress(answers).overallPercent,
        needsAgent: agentQueue(answers).length + deferredQuestions(answers).length,
        conflicts: detectConflicts(answers).length,
        linkSent: Boolean(live),
        linkExpiresAt: live?.expiresAt ?? null,
        updatedAt: deal.updatedAt,
      };
  });
}

export async function createDeal(
  agentId: string,
  input: { sellerName: string; sellerEmail: string; propertyAddress: string },
): Promise<string> {
  const [row] = await db
    .insert(deals)
    .values({ agentId, ...input })
    .returning({ id: deals.id });
  return row.id;
}

/**
 * Issue a magic link. Any live link for this deal is revoked first, so
 * "resend" cannot leave two working links in two inboxes.
 */
export async function issueDisclosureLink(dealId: string): Promise<string> {
  const ttlDays = Number(process.env.SELLER_TOKEN_TTL_DAYS ?? 14);
  const token = mintSellerToken();

  await db
    .update(disclosureRequests)
    .set({ revokedAt: new Date() })
    .where(eq(disclosureRequests.dealId, dealId));

  await db.insert(disclosureRequests).values({
    dealId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
  });

  // Returned once. Only the hash is stored.
  return token;
}

/** Scoped by agent — an agent can only ever open their own deal. */
export async function dealForAgent(dealId: string, agentId: string) {
  const [row] = await db
    .select()
    .from(deals)
    .innerJoin(agents, eq(agents.id, deals.agentId))
    .where(eq(deals.id, dealId))
    .limit(1);
  if (!row || row.deals.agentId !== agentId) return null;
  return row.deals;
}
