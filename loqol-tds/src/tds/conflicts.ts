/**
 * CONFLICTS
 *
 * The brief asks: "what do you do when they give you an answer that contradicts
 * one from three questions ago?"
 *
 * Three rules govern the answer:
 *
 * 1. NEVER BLOCK. Detection runs on every write, but nothing interrupts the
 *    seller mid-flow. Blocking a stressed person at 10pm is how you get an
 *    abandoned session, and an abandoned session is worse than an inconsistent
 *    one — the inconsistent one can be fixed at review.
 *
 * 2. NEVER AUTO-CORRECT. The seller owns this document and signs it under
 *    penalty. Silently "fixing" an answer is the single worst thing this system
 *    could do.
 *
 * 3. QUOTE BOTH ANSWERS BACK. "These two don't line up — which is right?" with
 *    both answers shown verbatim. Not "you made an error". The seller isn't
 *    wrong, the form is confusing.
 *
 * Conflicts surface in two places: as a quiet inline note next to the newer
 * answer, and as a review card before signing.
 */

import type { AnswerMap, AnswerValue, ConflictRule, DetectedConflict } from "./types";
import { composedText } from "./docuseal";

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

const val = (a: AnswerMap, id: string): AnswerValue =>
  a[id]?.status === "answered" ? a[id].value : null;

const isTrue = (a: AnswerMap, id: string) => val(a, id) === true;
const isFalse = (a: AnswerMap, id: string) => val(a, id) === false;
const has = (a: AnswerMap, id: string, opt: string) => {
  const v = val(a, id);
  return Array.isArray(v) && v.includes(opt);
};
const answered = (a: AnswerMap, id: string) => a[id]?.status === "answered";
const blank = (a: AnswerMap, id: string) => {
  const v = val(a, id);
  return v === null || v === "" || v === undefined;
};
/**
 * Will the shared explain box print empty?
 *
 * Not the same question as "is this answer blank". A composed box is filled by
 * the per-question explanations unless the seller has stored their own text, so
 * asking the answer alone would fire this rule at every seller who explained
 * each component in context and never retyped it into the summary.
 */
const composedBlank = (a: AnswerMap, id: string) =>
  composedText(id, a).value.trim() === "";

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export const CONFLICT_RULES: ConflictRule[] = [
  // --- Section A internal consistency -----------------------------------
  {
    id: "sewer_and_septic",
    severity: "hard",
    involves: ["A.public_sewer", "A.septic_tank"],
    detect: (a) => isTrue(a, "A.public_sewer") && isTrue(a, "A.septic_tank"),
    message: () =>
      "You've marked both a public sewer connection and a septic tank. Most homes have one or the other — which is it? (A few properties genuinely have both, so if that's your situation, just confirm and we'll leave it.)",
  },
  {
    id: "no_sewer_or_septic",
    severity: "soft",
    involves: ["A.public_sewer", "A.septic_tank"],
    detect: (a) =>
      answered(a, "A.public_sewer") &&
      answered(a, "A.septic_tank") &&
      isFalse(a, "A.public_sewer") &&
      isFalse(a, "A.septic_tank"),
    message: () =>
      "Neither public sewer nor septic is marked. Every home has one — worth a second look before we send this.",
  },
  {
    id: "pool_barrier_without_pool",
    severity: "hard",
    involves: ["A.pool", "A.pool_child_barrier"],
    detect: (a) => isTrue(a, "A.pool_child_barrier") && isFalse(a, "A.pool"),
    message: () =>
      "There's a child-resistant pool barrier marked, but no pool. One of those needs adjusting.",
  },
  {
    id: "pool_heater_no_pool_or_spa",
    severity: "soft",
    involves: ["A.pool_spa_heater", "A.pool", "A.hot_tub_spa"],
    detect: (a) =>
      isTrue(a, "A.pool_spa_heater") &&
      isFalse(a, "A.pool") &&
      isFalse(a, "A.hot_tub_spa"),
    message: () =>
      "A pool/spa heater is marked, but there's no pool or spa listed. Should one of those be checked?",
  },
  {
    id: "bars_without_release",
    severity: "soft",
    involves: ["A.window_security_bars", "A.quick_release"],
    detect: (a) =>
      isTrue(a, "A.window_security_bars") && isFalse(a, "A.quick_release"),
    message: () =>
      "You've got security bars on bedroom windows without quick-release latches. That's fine to disclose — it's a common situation — but buyers will ask about it, so it's worth being sure.",
  },

  // --- Section A gate vs Section B --------------------------------------
  {
    id: "all_operating_but_defects",
    severity: "hard",
    involves: ["A.not_operating", "B.gate"],
    detect: (a) => isFalse(a, "A.not_operating") && isTrue(a, "B.gate"),
    message: () =>
      "Earlier you said nothing in the home is broken, but you've since described problems with the building itself. Those can both be true — appliances working fine while the roof leaks — but let's make sure the first answer still reads right to you.",
  },
  {
    id: "roof_defect_no_roof_detail",
    severity: "soft",
    involves: ["B.components", "A.roof"],
    detect: (a) => has(a, "B.components", "roof") && blank(a, "A.roof"),
    message: () =>
      "You've flagged a roof problem, but the roof type and age are still blank. Buyers will connect those two immediately — worth filling in.",
  },
  {
    id: "plumbing_defect_vs_operating",
    severity: "soft",
    involves: ["B.components", "A.not_operating"],
    detect: (a) =>
      has(a, "B.components", "plumbing_sewers_septics") &&
      isFalse(a, "A.not_operating"),
    message: () =>
      "There's a plumbing or sewer problem noted here, but nothing was marked as not working earlier. Is there an appliance or fixture affected too?",
  },

  // --- Section B internal ------------------------------------------------
  {
    id: "b_yes_no_components",
    severity: "hard",
    involves: ["B.gate", "B.components"],
    detect: (a) => {
      const v = val(a, "B.components");
      return isTrue(a, "B.gate") && (!Array.isArray(v) || v.length === 0);
    },
    message: () =>
      "You said yes to problems with the building, but none of the specific areas are marked yet. Which parts are affected?",
  },
  {
    id: "b_components_no_gate",
    severity: "hard",
    involves: ["B.gate", "B.components"],
    detect: (a) => {
      const v = val(a, "B.components");
      return isFalse(a, "B.gate") && Array.isArray(v) && v.length > 0;
    },
    message: () =>
      "Specific building problems are marked, but the overall answer is set to no. The two need to agree before this can go out.",
  },
  {
    id: "b_yes_no_explanation",
    severity: "hard",
    involves: ["B.gate", "B.explain"],
    detect: (a) => isTrue(a, "B.gate") && composedBlank(a, "B.explain"),
    message: () =>
      "The explanation for the building problems is still empty. This is the part buyers actually read — a couple of sentences is enough.",
  },

  // --- Section C internal ------------------------------------------------
  {
    id: "hoa_without_ccrs",
    severity: "hard",
    involves: ["C.13", "C.12"],
    detect: (a) => isTrue(a, "C.13") && isFalse(a, "C.12"),
    message: () =>
      "You've said there's an HOA but no CC&Rs. Almost every HOA is built on a set of CC&Rs, even if you've never had to read them — so this pair is usually both yes.",
  },
  {
    id: "common_area_without_hoa",
    severity: "soft",
    involves: ["C.14", "C.13"],
    detect: (a) => isTrue(a, "C.14") && isFalse(a, "C.13"),
    message: () =>
      "There are shared common areas but no HOA. That does happen — some shared roads and greenbelts are owned directly by the neighbors — but it's unusual enough to double-check.",
  },
  {
    id: "unpermitted_but_to_code",
    severity: "soft",
    involves: ["C.4", "C.5"],
    detect: (a) => isTrue(a, "C.4") && isFalse(a, "C.5"),
    message: () =>
      "You've noted work done without permits, but nothing out of code. That's possible — plenty of unpermitted work is built properly — so if that's what you mean, we'll leave it as is.",
  },
  {
    id: "common_area_pool_not_listed",
    severity: "soft",
    involves: ["C.14", "A.pool"],
    detect: (a) => isTrue(a, "C.14") && isFalse(a, "A.pool"),
    message: () =>
      "Just so it's clear: the shared pool or facilities you mentioned belong to the community, not to this property — so it's correct that no pool is marked in the home features. Confirm and we'll move on.",
  },
  {
    id: "flooding_no_but_sump_pump",
    severity: "soft",
    involves: ["C.8", "A.sump_pump"],
    detect: (a) => isFalse(a, "C.8") && isTrue(a, "A.sump_pump"),
    message: () =>
      "There's a sump pump listed, but no drainage or flooding issues noted. A pump usually means water has needed managing at some point — even if it's never been a problem for you, buyers will ask why it's there.",
  },
  {
    id: "c_yes_without_explanation",
    severity: "hard",
    involves: ["C.explain"],
    detect: (a) => {
      for (let n = 1; n <= 16; n++) {
        if (isTrue(a, `C.${n}`)) {
          const e = a[`C.${n}.explanation`];
          if (!e || e.status !== "answered" || !String(e.value ?? "").trim()) {
            return true;
          }
        }
      }
      return false;
    },
    message: (a) => {
      const missing: number[] = [];
      for (let n = 1; n <= 16; n++) {
        if (isTrue(a, `C.${n}`)) {
          const e = a[`C.${n}.explanation`];
          if (!e || e.status !== "answered" || !String(e.value ?? "").trim()) {
            missing.push(n);
          }
        }
      }
      return `A few of your yes answers still need a sentence of explanation (${missing.join(", ")}). Without it, a buyer's agent will come back asking — easier to do it now.`;
    },
  },

  // --- Section D vs Section A -------------------------------------------
  {
    id: "no_smoke_detectors_but_affirming",
    severity: "soft",
    involves: ["A.smoke_detectors", "D.1"],
    detect: (a) => isFalse(a, "A.smoke_detectors") && answered(a, "D.1"),
    message: () =>
      "No smoke detectors are listed in the home features, and you're confirming the home will have working ones at closing. That's fine — you just need to install them before the sale closes. Flagging it so it isn't a surprise.",
  },
  {
    id: "water_heater_type_missing",
    severity: "soft",
    involves: ["A.water_heater_type"],
    detect: (a) => {
      const v = val(a, "A.water_heater_type");
      return answered(a, "A.water_heater_type") && Array.isArray(v) && v.length === 0;
    },
    message: () =>
      "The water heater type is still blank. If you're not sure, gas units usually have a small window near the base with a flame behind it — or your agent can confirm it on the walkthrough.",
  },

  // --- Occupancy sanity ---------------------------------------------------
  {
    id: "not_occupying_lots_of_detail",
    severity: "soft",
    involves: ["occupancy", "C.11"],
    detect: (a) => val(a, "occupancy") === "is_not" && isTrue(a, "C.11"),
    message: () =>
      "You don't live at the property but have noted neighborhood noise. That's fine to disclose — just make sure it's something you know rather than something you've been told, since this form is about your own knowledge.",
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export function detectConflicts(answers: AnswerMap): DetectedConflict[] {
  const found: DetectedConflict[] = [];
  for (const rule of CONFLICT_RULES) {
    let hit = false;
    try {
      hit = rule.detect(answers);
    } catch {
      hit = false; // a broken rule must never break the seller's session
    }
    if (hit) {
      found.push({
        ruleId: rule.id,
        severity: rule.severity,
        involves: rule.involves,
        message: rule.message(answers),
      });
    }
  }
  // Hard conflicts first — they're the ones worth the seller's attention.
  return found.sort((x, y) =>
    x.severity === y.severity ? 0 : x.severity === "hard" ? -1 : 1,
  );
}

/**
 * Conflicts touching the question just answered. These get a quiet inline note;
 * everything else waits for the review screen.
 */
export function conflictsFor(
  questionId: string,
  answers: AnswerMap,
): DetectedConflict[] {
  return detectConflicts(answers).filter((c) => c.involves.includes(questionId));
}

/**
 * Hard conflicts don't block signing either — they get a prominent review card
 * the seller has to look at and dismiss. A seller who insists both answers are
 * right is allowed to be right; we record the acknowledgement and move on.
 */
export function blockingConflicts(answers: AnswerMap): DetectedConflict[] {
  return detectConflicts(answers).filter((c) => c.severity === "hard");
}
