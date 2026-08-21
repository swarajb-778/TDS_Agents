import { agentOnlyQuestions } from "@/tds/registry";
import { NewDealForm } from "./form";

export const dynamic = "force-dynamic";

export default function NewDeal() {
  // Serialise only what the form needs — the registry stays the source.
  const questions = agentOnlyQuestions().map((q) => ({
    id: q.id,
    label: q.sellerLabel ?? q.label,
    hint: q.plainEnglish,
    type: q.type,
    options: q.options ?? null,
    gatedBy: q.gatedBy?.questionId ?? null,
  }));
  return <NewDealForm questions={questions} />;
}
