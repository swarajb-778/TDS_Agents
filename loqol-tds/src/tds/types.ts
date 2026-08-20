/**
 * Core types for the TDS question registry.
 *
 * The registry is the single source of truth. The form renderer, the voice
 * agent's tool schemas, the progress meter, the conflict engine, and the
 * DocuSeal field map are all derived from it — nothing else redefines a
 * question.
 */

// ---------------------------------------------------------------------------
// Chapters — the seller-facing flow order, which is NOT the PDF's order.
// ---------------------------------------------------------------------------

export type ChapterId =
  | "confirm" // agent-prefilled property details, seller just confirms
  | "basics" // occupancy
  | "features" // Section A inventory — fast, mechanical, form
  | "condition" // Section A operating-condition gate — voice
  | "defects" // Section B — voice-led, form-confirmed
  | "awareness" // Section C — voice
  | "affirmations" // Section D — acknowledge only
  | "sign"; // handoff to DocuSeal

export interface Chapter {
  id: ChapterId;
  /** Seller-facing name. Never say "Section B" to a seller. */
  title: string;
  /** One line shown before the chapter starts, sets expectations. */
  intro: string;
  /** Which TDS section this maps to, for the agent view and audit trail. */
  tdsSection: string;
  order: number;
}

// ---------------------------------------------------------------------------
// Question shape
// ---------------------------------------------------------------------------

export type QuestionType =
  | "boolean" // yes/no or present/absent
  | "enum" // pick exactly one
  | "multi_enum" // pick any number (e.g. water heater: gas AND solar)
  | "text" // short free text
  | "long_text" // narrative — the explain fields
  | "number"
  | "date"
  | "acknowledgement"; // nothing to collect; seller reads and confirms

/**
 * Which input path a question defaults to.
 *
 * This is a DEFAULT, not a jail. Every question is reachable from both paths;
 * `defaultModality` only decides where the seller lands first. The seller can
 * override per question and the override is remembered for the session.
 *
 * "agent" means the seller never sees it — the listing agent fills it before
 * the request is sent (legal description, county, substituted disclosures).
 */
export type Modality = "form" | "voice" | "agent" | "none";

export interface Option {
  value: string;
  /** Seller-facing label. */
  label: string;
  /** Optional plain-English gloss shown under the label. */
  hint?: string;
}

/**
 * A question only becomes visible when its gate passes. This is how Section B's
 * Yes/No gates its sixteen components, and how "Automatic Garage Door Opener"
 * gates the remote-control count.
 */
export interface Gate {
  questionId: string;
  /** Gate passes when the gating answer equals / includes any of these. */
  equals?: AnswerValue;
  includes?: string;
  isTruthy?: boolean;
}

/**
 * Follow-ups are the answer to "some need a follow-up before the answer is
 * usable". A `yes` on C.7 is worthless on its own — the narrative is the
 * legally load-bearing part.
 *
 * `into` names the shared PDF field the follow-ups are composed into. We store
 * them per-question (`C.7.explanation`) and merge at render time, because
 * asking a seller to explain sixteen yeses in one box at the end produces mush.
 */
export interface FollowUp {
  when: AnswerValue;
  /** Synthesised question id is `${parentId}.explanation`. */
  prompt: string;
  voicePrompt?: string;
  into: string;
  required: boolean;
}

export type AnswerValue = boolean | string | number | string[] | null;

/**
 * How this question lands in the PDF. The registry owns the mapping so the
 * DocuSeal layer is a pure function with no per-question special cases.
 */
export type DocuSealMapping =
  /** One checkbox, ticked when the answer is true. Section A inventory. */
  | { kind: "checkbox"; field: string }
  /** Paired Yes/No checkboxes. Section B gate, all of Section C. */
  | { kind: "yes_no"; yesField: string; noField: string }
  /** One checkbox per option. Water heater, water supply, garage. */
  | { kind: "enum_checkboxes"; fields: Record<string, string> }
  /** Free text straight into a text field. */
  | { kind: "text"; field: string }
  /** A shared explain box assembled from per-question follow-ups. */
  | { kind: "composed"; field: string; source: "explanations" }
  /** Collected for the seller experience but not printed. */
  | { kind: "none" };

export interface Question {
  id: string;
  chapter: ChapterId;
  /** Sub-grouping inside a chapter — drives the form's visual grouping. */
  group?: string;

  /** The label as it reads on the TDS. Kept verbatim for the agent view. */
  label: string;
  /** What the seller actually sees. Plain English, no statute numbers. */
  sellerLabel?: string;
  /** Expanded explanation, available on tap or when the seller asks "what?". */
  plainEnglish?: string;
  /** One line: why a buyer needs to know this. Reduces defensiveness. */
  whyWeAsk?: string;
  /** Concrete examples. The single highest-value field in this whole file. */
  examples?: string[];
  /** How the voice agent asks it. Conversational, primes recall. */
  voicePrompt?: string;

  type: QuestionType;
  options?: Option[];

  defaultModality: Modality;
  /**
   * "I don't know" is a first-class answer, not a failure. On a TDS it is often
   * legitimately "No — not aware", and the agent should surface that difference
   * rather than silently coercing it.
   */
  allowUnknown: boolean;
  required: boolean;

  gatedBy?: Gate;
  followUp?: FollowUp;

  docuseal: DocuSealMapping;

  /** Rough seconds to answer, used for the adaptive time-remaining estimate. */
  estimatedSeconds: number;
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

export type AnswerStatus =
  | "unanswered"
  | "answered"
  | "unknown" // seller said they don't know — routes to the agent queue
  | "skipped" // seller chose to come back to it
  | "flagged_for_agent"; // seller wants a human to look at it

export interface Answer {
  questionId: string;
  value: AnswerValue;
  status: AnswerStatus;
  /** Which path produced it. Needed for the audit trail on a legal document. */
  source: Modality;
  /** Voice only. Below threshold, the server rejects the write and re-asks. */
  confidence?: number;
  /** Voice only. What the seller actually said, kept for the agent's review. */
  verbatim?: string;
  updatedAt: string;
  note?: string;
}

export type AnswerMap = Record<string, Answer>;

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

export interface ConflictRule {
  id: string;
  /**
   * "hard" = almost certainly a mistake, surface prominently at review.
   * "soft" = plausible but worth confirming.
   * Neither ever blocks the seller mid-flow.
   */
  severity: "hard" | "soft";
  /** Question ids involved — used to quote both answers back verbatim. */
  involves: string[];
  /** Seller-facing. Names both answers, asks which is right, never accuses. */
  message: (a: AnswerMap) => string;
  detect: (a: AnswerMap) => boolean;
}

export interface DetectedConflict {
  ruleId: string;
  severity: "hard" | "soft";
  involves: string[];
  message: string;
}
