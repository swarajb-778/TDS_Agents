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
    parts.push(`${n}. ${body}`);
  }
  return parts.join("  ");
}

/** Parent question ids whose follow-ups compose into a given shared field. */
function sourcesFor(field: string): string[] {
  return QUESTIONS.filter((q) => q.followUp?.into === field).map((q) => q.id);
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
        const sources = sourcesFor(q.id);
        // A composed box can also be edited directly by the seller at review.
        // If they touched it, their text wins over the machine-assembled one.
        const edited =
          a?.status === "answered" ? String(a.value ?? "").trim() : "";
        const composed = composeExplanations(answers, sources);
        const value = edited || composed;
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
// Template geometry (route B)
//
// Section C is the one block regular enough to place programmatically: sixteen
// rows, constant Yes/No x-positions, near-constant row pitch. Extract the row
// baselines once with pdfplumber/PyMuPDF, drop them here, and the template
// regenerates from the registry. Everything else gets placed by hand.
//
// Coordinates are placeholders — replace with real extracted values.
// ---------------------------------------------------------------------------

export interface FieldArea {
  x: number;
  y: number;
  w: number;
  h: number;
  page: number;
}

export const SECTION_C_GEOMETRY = {
  page: 2,
  yesX: 0.845,
  noX: 0.895,
  boxW: 0.012,
  boxH: 0.012,
  /** Row baselines, normalised 0-1 from the top of the page. */
  rowY: [
    0.395, 0.428, 0.447, 0.466, 0.485, 0.504, 0.523, 0.542, 0.561, 0.580,
    0.599, 0.618, 0.637, 0.664, 0.683, 0.775,
  ],
};

/** Field definitions for `create_template_from_pdf`, derived from the registry. */
export function sectionCTemplateFields(): Array<{
  name: string;
  type: "checkbox";
  role: string;
  areas: FieldArea[];
}> {
  const g = SECTION_C_GEOMETRY;
  const fields: Array<{
    name: string;
    type: "checkbox";
    role: string;
    areas: FieldArea[];
  }> = [];

  for (let n = 1; n <= 16; n++) {
    const q = getQuestion(`C.${n}`);
    if (!q || q.docuseal.kind !== "yes_no") continue;
    const y = g.rowY[n - 1];
    fields.push({
      name: q.docuseal.yesField,
      type: "checkbox",
      role: ROLES.SELLER_1,
      areas: [{ x: g.yesX, y, w: g.boxW, h: g.boxH, page: g.page }],
    });
    fields.push({
      name: q.docuseal.noField,
      type: "checkbox",
      role: ROLES.SELLER_1,
      areas: [{ x: g.noX, y, w: g.boxW, h: g.boxH, page: g.page }],
    });
  }

  return fields;
}

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
  ["property_address_p2", "property_address_p3", "date_p2", "date_p3"].forEach(
    (f) => names.add(f),
  );
  return [...names].sort();
}
