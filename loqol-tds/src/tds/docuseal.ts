/**
 * DOCUSEAL
 *
 * Because every question carries its own `docuseal` mapping, this whole layer is
 * a pure function over the answer set with zero per-question special cases. Add
 * a question to the registry and it lands in the PDF; nothing here changes.
 *
 * Template creation: the attached TDS is a flat PDF with no fillable fields, so
 * there are two routes.
 *
 *   A. Place fields by hand in the DocuSeal template builder. Reliable, visual,
 *      a couple of hours for the fields that matter.
 *   B. `create_template_from_pdf`, which takes the base64 PDF plus a `fields`
 *      array where each field has `areas: [{ x, y, w, h, page }]`. Reproducible
 *      and version-controlled — the template regenerates from this registry.
 *
 * Recommended split: B for Section C (sixteen regular Yes/No pairs, highly
 * scriptable — see FIELD_GEOMETRY below), A for Section A's irregular grid and
 * the signature blocks.
 *
 * SIGNER ROLES: a TDS is completed at listing, before any offer exists. Buyer
 * roles are declared but deliberately left unassigned — the buyer signs the
 * acknowledgement of receipt later, in a second submission.
 */

import type { AnswerMap, AnswerValue } from "./types";
import { QUESTIONS, getQuestion } from "./registry";

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const ROLES = {
  SELLER_1: "Seller 1",
  SELLER_2: "Seller 2",
  LISTING_AGENT: "Listing Agent",
  BUYER_1: "Buyer 1", // unassigned at disclosure time
  BUYER_2: "Buyer 2", // unassigned at disclosure time
  SELLING_AGENT: "Selling Agent", // unassigned at disclosure time
} as const;

/** Roles that actually get a submitter on the disclosure-stage submission. */
export const DISCLOSURE_STAGE_ROLES = [
  ROLES.SELLER_1,
  ROLES.SELLER_2,
  ROLES.LISTING_AGENT,
];

/**
 * Signer fields. Not registry entries — nobody *answers* a signature, and the
 * registry is a catalogue of questions. These live here beside the roles they
 * belong to, and geometry is resolved in scripts/build-template.ts like
 * everything else.
 *
 * Only the three disclosure-stage roles appear. The buyer acknowledgement block
 * and the selling agent's line are left unassigned on purpose: a TDS is
 * completed at listing and there is no buyer yet.
 */
export interface SignerField {
  name: string;
  type: "signature" | "initials" | "date" | "text";
  role: string;
}

export const SIGNER_FIELDS: SignerField[] = [
  { name: "seller1_signature", type: "signature", role: ROLES.SELLER_1 },
  { name: "seller1_date", type: "date", role: ROLES.SELLER_1 },
  { name: "seller1_initials", type: "initials", role: ROLES.SELLER_1 },
  { name: "seller2_signature", type: "signature", role: ROLES.SELLER_2 },
  { name: "seller2_date", type: "date", role: ROLES.SELLER_2 },
  { name: "seller2_initials", type: "initials", role: ROLES.SELLER_2 },
  { name: "agent_name", type: "text", role: ROLES.LISTING_AGENT },
  { name: "agent_signature", type: "signature", role: ROLES.LISTING_AGENT },
  { name: "agent_date", type: "date", role: ROLES.LISTING_AGENT },
];

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export type FieldValues = Record<string, string | boolean>;

const CHECKED = true;

function text(v: AnswerValue): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

/**
 * Compose a shared explain box from the per-question follow-ups.
 *
 * The PDF gives Section C one text box for sixteen questions. We stored them
 * separately so the seller answers each in context; here we merge them back,
 * numbered, so a buyer's agent can tell which explanation belongs to which
 * question. That numbering is the whole reason for the round trip.
 *
 * This is the ONLY place that knows the numbering format. The seller now reads
 * this exact string on screen before signing, so the format is seller-facing
 * copy as much as it is PDF output — one implementation, or the two drift.
 *
 * The number is the question's own id suffix, which only reads as a number when
 * there is a numbered list to point back at (`C.7` -> "7."). A box fed by a
 * single non-numbered question (`B.components`, `A.not_operating`) gets no
 * prefix: there is nothing for "components." to disambiguate, and on screen it
 * reads as a typo.
 */
export function composeExplanations(
  answers: AnswerMap,
  parentIds: string[],
): string {
  const parts: string[] = [];
  for (const pid of parentIds) {
    const e = answers[`${pid}.explanation`];
    if (!e || e.status !== "answered") continue;
    const body = String(e.value ?? "").trim();
    if (!body) continue;
    const n = pid.includes(".") ? pid.split(".")[1] : pid;
    parts.push(/^\d+$/.test(n) ? `${n}. ${body}` : body);
  }
  return parts.join("  ");
}

/**
 * Parent question ids whose follow-ups compose into a given shared box.
 *
 * Derived from the registry's `followUp.into`, never a hand-kept list — adding
 * a seventeenth awareness question feeds the box with no change here.
 */
export function explanationSources(composedQuestionId: string): string[] {
  return QUESTIONS.filter((q) => q.followUp?.into === composedQuestionId).map(
    (q) => q.id,
  );
}

/** What a composed box currently holds, and where that text came from. */
export interface ComposedText {
  /** The draft assembled from the seller's per-question explanations. */
  composed: string;
  /** What actually goes on the form. */
  value: string;
  /**
   * True when `value` is the seller's own text rather than the assembly —
   * either because they rewrote it or because they read the draft and
   * confirmed it, which stores it verbatim.
   */
  edited: boolean;
  /**
   * True when the assembly has moved on since the seller stored their version,
   * i.e. they changed an earlier answer afterwards. Surfaced to the seller as a
   * choice; never resolved for them.
   */
  stale: boolean;
  /** Parent question ids feeding the assembly. */
  sources: string[];
}

/**
 * PRECEDENCE: what the seller last saw and approved is what goes on the form.
 *
 * The assembly is a draft. It fills the box while the seller has nothing stored
 * against the composed question, which is also what lets a later edit to an
 * individual explanation flow straight through. The moment they confirm or
 * change the text, that exact string is stored and it wins from then on —
 * recomposition never writes over it, not on the next render and not at PDF
 * time. They sign this under penalty of perjury; the text on the page has to be
 * the text they read.
 *
 * That includes clearing it. An empty stored value is a deliberate act on the
 * exact words that print, so it stands, and the missing-explanation conflict
 * rules pick it up at review rather than this function quietly refilling it.
 *
 * When the draft moves on afterwards, `stale` says so and the seller is offered
 * the newer draft. Taking it is their tap, not ours.
 */
export function composedText(
  composedQuestionId: string,
  answers: AnswerMap,
): ComposedText {
  const sources = explanationSources(composedQuestionId);
  const composed = composeExplanations(answers, sources);

  const stored = answers[composedQuestionId];
  const hasStored = stored?.status === "answered";
  const value = hasStored ? String(stored.value ?? "") : composed;

  return {
    composed,
    value,
    edited: hasStored,
    stale: hasStored && value.trim() !== composed.trim(),
    sources,
  };
}

/**
 * The whole mapping: answers in, DocuSeal field values out.
 */
export function toFieldValues(answers: AnswerMap): FieldValues {
  const out: FieldValues = {};

  for (const q of QUESTIONS) {
    const a = answers[q.id];
    const m = q.docuseal;

    // "Unknown" is not "no". Leaving a checkbox blank is the honest rendering
    // of an unanswered question on a legal disclosure — do not infer.
    if (m.kind === "none") continue;

    switch (m.kind) {
      case "checkbox": {
        if (a?.status === "answered" && a.value === true) {
          out[m.field] = CHECKED;
        }
        break;
      }

      case "yes_no": {
        if (a?.status !== "answered") break;
        if (a.value === true) out[m.yesField] = CHECKED;
        else if (a.value === false) out[m.noField] = CHECKED;
        break;
      }

      case "enum_checkboxes": {
        if (a?.status !== "answered") break;
        const selected = Array.isArray(a.value)
          ? a.value
          : a.value === null
            ? []
            : [String(a.value)];
        for (const s of selected) {
          const f = m.fields[s];
          if (f) out[f] = CHECKED;
        }
        break;
      }

      case "text": {
        if (a?.status === "answered") out[m.field] = text(a.value);
        break;
      }

      case "composed": {
        // Precedence lives in composedText(), so the string the seller read on
        // the review screen and the string that lands in the PDF are resolved
        // by the same function. See the comment there.
        const value = composedText(q.id, answers).value.trim();
        if (value) out[m.field] = value;
        break;
      }
    }
  }

  // Repeated header fields — the address and date appear on all three pages.
  const addr = answers["meta.address"];
  const date = answers["meta.date"];
  if (addr?.status === "answered") {
    out["property_address_p2"] = text(addr.value);
    out["property_address_p3"] = text(addr.value);
  }
  if (date?.status === "answered") {
    out["date_p2"] = text(date.value);
    out["date_p3"] = text(date.value);
  }

  // Pages 2 and 3 each repeat the address and date in their header. One
  // answer, three slots — mirrored here rather than asked for three times.
  const address = out["property_address"];
  if (typeof address === "string" && address) {
    out["property_address_p2"] = address;
    out["property_address_p3"] = address;
  }
  const disclosureDate = out["disclosure_date"];
  if (typeof disclosureDate === "string" && disclosureDate) {
    out["date_p2"] = disclosureDate;
    out["date_p3"] = disclosureDate;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

export interface Submitter {
  role: string;
  name?: string;
  email: string;
}

export interface SubmissionPayload {
  template_id: number;
  send_email: boolean;
  order: "preserved" | "random";
  submitters: Array<{
    role: string;
    name?: string;
    email: string;
    values: FieldValues;
    /** Everything derived from the interview is locked. The seller answered it
     *  already; making them re-enter it in a PDF viewer would be absurd. */
    readonly_fields: string[];
    fields?: Array<{ name: string; default_value?: string; readonly?: boolean }>;
  }>;
}

export function buildSubmission(opts: {
  templateId: number;
  answers: AnswerMap;
  sellers: Submitter[];
  listingAgent: Submitter;
  sendEmail?: boolean;
}): SubmissionPayload {
  const values = toFieldValues(opts.answers);
  const locked = Object.keys(values);

  const submitters = [
    ...opts.sellers.map((s, i) => ({
      role: i === 0 ? ROLES.SELLER_1 : ROLES.SELLER_2,
      name: s.name,
      email: s.email,
      // All the interview-derived values ride on the first submitter; the
      // second seller just signs.
      values: i === 0 ? values : {},
      readonly_fields: i === 0 ? locked : [],
    })),
    {
      role: ROLES.LISTING_AGENT,
      name: opts.listingAgent.name,
      email: opts.listingAgent.email,
      values: {},
      readonly_fields: [],
    },
  ];

  return {
    template_id: opts.templateId,
    send_email: opts.sendEmail ?? true,
    order: "preserved", // sellers sign, then the agent countersigns
    submitters,
  };
}

// ---------------------------------------------------------------------------
// Template geometry
//
// Deliberately NOT here. Every checkbox on the TDS is a "□" glyph with a real
// position in the PDF's content stream, so the whole template is generated by
// matching those glyphs to this registry — see scripts/build-template.ts and
// scripts/extract_boxes.py. 127 of 135 fields place automatically.
//
// A second, hand-maintained copy of the coordinates used to live here. It was
// removed rather than updated: two sources of geometry, one of them stale, is
// exactly the failure this file warns about elsewhere — the submission still
// succeeds and the answer lands in the wrong place, or nowhere.
//
// The eight fields that do not place have no slot on the supplied PDF at all:
// it is a paraphrased regeneration of the C.A.R. form, missing the checkboxes
// for Fireplace / Exhaust Fan / 220 Volt Wiring and any street-address line.
// ---------------------------------------------------------------------------

/** Every field name the registry expects to exist in the template. Diff this
 *  against the template you actually built — it's the fastest way to catch a
 *  typo'd field name before it silently drops an answer on the floor. */
export function expectedFieldNames(): string[] {
  const names = new Set<string>();
  for (const q of QUESTIONS) {
    const m = q.docuseal;
    if (m.kind === "checkbox" || m.kind === "text" || m.kind === "composed") {
      names.add(m.field);
    } else if (m.kind === "yes_no") {
      names.add(m.yesField);
      names.add(m.noField);
    } else if (m.kind === "enum_checkboxes") {
      Object.values(m.fields).forEach((f) => names.add(f));
    }
  }
  // Repeated header slots on pages 2 and 3, filled from the same answer.
  ["property_address_p2", "property_address_p3", "date_p2", "date_p3"].forEach(
    (f) => names.add(f),
  );
  SIGNER_FIELDS.forEach((f) => names.add(f.name));
  return [...names].sort();
}
