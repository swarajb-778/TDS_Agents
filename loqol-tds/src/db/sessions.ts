/**
 * Per-deal session preferences.
 *
 * Only what cannot be derived: which path the seller was last on, and any
 * per-question overrides. Position is NOT here — resume() works it out from the
 * answers, so there is no cursor to drift.
 */

import { eq } from "drizzle-orm";
import { db } from "./index";
import { sessions } from "./schema";
import type { Modality } from "../tds/types";

export interface SellerPreferences {
  /**
   * null means the seller has never chosen. That is different from choosing
   * "form": a seller who has only ever seen the form-only chapters must still
   * be offered voice when they reach the parts where it earns its place.
   */
  modality: Modality | null;
  overrides: Record<string, Modality>;
}

const NO_PREFERENCE: SellerPreferences = { modality: null, overrides: {} };

export async function loadPreferences(dealId: string): Promise<SellerPreferences> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.dealId, dealId))
    .limit(1);
  if (!row) return NO_PREFERENCE;
  return { modality: row.modality, overrides: row.overrides ?? {} };
}

/** Remembering the choice is the point: modality is a default, not a jail. */
export async function savePreferences(
  dealId: string,
  patch: { modality?: Modality; overrides?: Record<string, Modality> },
): Promise<void> {
  const current = await loadPreferences(dealId);
  const modality = patch.modality ?? current.modality ?? "form";
  const overrides = patch.overrides ?? current.overrides;
  await db
    .insert(sessions)
    .values({ dealId, modality, overrides })
    .onConflictDoUpdate({
      target: sessions.dealId,
      set: { modality, overrides, updatedAt: new Date() },
    });
}
