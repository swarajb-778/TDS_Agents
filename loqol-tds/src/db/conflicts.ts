/**
 * Conflict acknowledgements.
 *
 * Detection is pure and lives in src/tds/conflicts.ts. This is the one piece
 * that has to persist: which contradictions the seller has already been shown
 * and stood by, so the review screen stops raising them.
 */

import { and, eq } from "drizzle-orm";
import { db } from "./index";
import { conflictAcknowledgements } from "./schema";
import type { Actor } from "./answers";
import { detectConflicts } from "../tds/conflicts";
import type { AnswerMap, DetectedConflict } from "../tds/types";

export async function acknowledgedRuleIds(dealId: string): Promise<string[]> {
  const rows = await db
    .select({ ruleId: conflictAcknowledgements.ruleId })
    .from(conflictAcknowledgements)
    .where(eq(conflictAcknowledgements.dealId, dealId));
  return rows.map((r) => r.ruleId);
}

export async function acknowledgeConflict(
  dealId: string,
  ruleId: string,
  actor: Actor,
  note?: string,
): Promise<void> {
  await db
    .insert(conflictAcknowledgements)
    .values({ dealId, ruleId, note: note ?? null, actorType: actor.type, actorId: actor.id })
    .onConflictDoUpdate({
      target: [conflictAcknowledgements.dealId, conflictAcknowledgements.ruleId],
      set: { note: note ?? null, createdAt: new Date() },
    });
}

export async function unacknowledgeConflict(dealId: string, ruleId: string): Promise<void> {
  await db
    .delete(conflictAcknowledgements)
    .where(
      and(
        eq(conflictAcknowledgements.dealId, dealId),
        eq(conflictAcknowledgements.ruleId, ruleId),
      ),
    );
}

export interface ReviewedConflict extends DetectedConflict {
  acknowledged: boolean;
}

/**
 * Everything currently contradictory, hard first, with what the seller has
 * already stood by marked rather than hidden — the agent still needs to see it.
 */
export async function reviewConflicts(
  dealId: string,
  answers: AnswerMap,
): Promise<ReviewedConflict[]> {
  const acked = new Set(await acknowledgedRuleIds(dealId));
  return detectConflicts(answers).map((c) => ({
    ...c,
    acknowledged: acked.has(c.ruleId),
  }));
}
