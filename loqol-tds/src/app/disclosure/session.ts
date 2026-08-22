import { redirect } from "next/navigation";
import { loadAnswers } from "@/db/answers";
import { currentSeller } from "@/db/seller-guard";
import { loadPreferences } from "@/db/sessions";
import type { AnswerMap, Modality } from "@/tds/types";

/**
 * What every seller screen needs, resolved once.
 *
 * Anything that is not a live disclosure leaves through /disclosure/help, which
 * works out which of the five outcomes it actually is. A seller never sees a
 * 404 — a stressed person at 10pm who hits "Not Found" is gone.
 */
export interface SellerScreen {
  dealId: string;
  sellerName: string;
  propertyAddress: string;
  answers: AnswerMap;
  /** null when they have never chosen; the registry decides in that case. */
  modality: Modality | null;
  submittedAt: Date | null;
}

export async function sellerScreen(): Promise<SellerScreen> {
  const access = await currentSeller();
  if (access.outcome !== "valid" && access.outcome !== "submitted") {
    redirect("/disclosure/help");
  }

  const [answers, preferences] = await Promise.all([
    loadAnswers(access.session.dealId),
    loadPreferences(access.session.dealId),
  ]);

  return {
    dealId: access.session.dealId,
    sellerName: access.session.sellerName,
    propertyAddress: access.session.propertyAddress,
    answers,
    modality: preferences.modality,
    submittedAt: access.outcome === "submitted" ? access.submittedAt : null,
  };
}
