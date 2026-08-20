/**
 * Builds the DocuSeal template from the blank PDF, programmatically.
 *
 * The TDS is flat, but every checkbox on it is a "□" glyph with a real position
 * in the content stream. scripts/extract_boxes.py pulls those out with their
 * trailing label; this matches them to the registry and emits the `fields`
 * array for create_template_from_pdf.
 *
 * Field NAMES always come from the registry's `docuseal` mapping. Only geometry
 * is resolved here — the anchors below are y-positions in the PDF, never names.
 *
 *   npx tsx scripts/build-template.ts          # report only
 *   npx tsx scripts/build-template.ts --create # create it in DocuSeal
 */

import { readFileSync } from "node:fs";
import { QUESTIONS, getQuestion } from "../src/tds/registry";
import { SIGNER_FIELDS, expectedFieldNames, ROLES } from "../src/tds/docuseal";

interface Glyph {
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  label: string;
}

const PAGE_W = 612;
const PAGE_H = 792;

const glyphs: Glyph[] = JSON.parse(
  readFileSync(new URL("../assets/tds-boxes.json", import.meta.url), "utf8"),
);

/** Collapses kerning ("G a s Starter") and punctuation ("Roof(s)"). */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const near = (a: number, b: number, tol = 2) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------------------
// Anchors — geometry only. Used where a label alone is ambiguous, because
// "Gas / Solar / Electric" appears twice on the page: once under "Pool/Spa
// Heater:" and once under "Water Heater:".
// ---------------------------------------------------------------------------

const OPTION_GROUPS: Array<{
  questionId: string;
  page: number;
  y: number[];
  /** The page has three columns; a row anchor alone catches the neighbours. */
  x: [number, number];
}> = [
  { questionId: "meta.substituted_disclosures", page: 0, y: [256.9, 269.9, 301.4], x: [40, 120] },
  { questionId: "occupancy", page: 0, y: [406.1], x: [60, 120] },
  { questionId: "A.pool_spa_heater_type", page: 0, y: [463.5], x: [395, 582] },
  { questionId: "A.water_heater_type", page: 0, y: [484.2], x: [395, 582] },
  { questionId: "A.water_supply", page: 0, y: [505.2, 515.7], x: [395, 582] },
  { questionId: "A.garage_type", page: 0, y: [545.2], x: [200, 395] },
  { questionId: "A.gas_supply", page: 0, y: [547.2], x: [395, 582] },
  { questionId: "B.components", page: 1, y: [61.1, 75.8], x: [0, 582] },
];

/**
 * Boxes the form is missing.
 *
 * "Pool:" sits directly parallel to "□ Hot Tub/Spa:" but its glyph is absent
 * from this PDF's content stream — the label is there, the box is not. We place
 * one where the neighbouring rows put theirs.
 *
 * Exhaust Fan(s), 220 Volt Wiring and Fireplace(s) are NOT in here: the real
 * TDS has no checkbox for those either, only a "in ______" blank. Their text
 * fields carry the answer, and their registry checkbox has nowhere to land.
 */
const MISSING_BOXES: Array<{ questionId: string; page: number; x: number; y: number }> = [
  { questionId: "A.pool", page: 0, x: 395.5, y: 432.8 },
];

/** Yes/No pairs, in document order. Both boxes sit on one row. */
const YES_NO_ROWS: Array<{ questionId: string; page: number; y: number }> = [
  { questionId: "A.not_operating", page: 0, y: 693.0 },
  { questionId: "B.gate", page: 1, y: 34.8 },
  ...[
    301.2, 326.5, 339.4, 354.4, 369.4, 384.4, 399.2, 414.2, 429.2, 444.2,
    458.9, 473.9, 488.9, 516.5, 529.2, 607.5,
  ].map((y, i) => ({ questionId: `C.${i + 1}`, page: 1, y })),
];

// ---------------------------------------------------------------------------

interface Field {
  name: string;
  type: "checkbox" | "text" | "signature" | "initials" | "date";
  role: string;
  areas: Array<{ x: number; y: number; w: number; h: number; page: number }>;
  preferences?: { font_size: number };
}

/**
 * Text slots, in PDF points.
 *
 * Question ids, never field names — the name is read off the registry's
 * `docuseal` mapping so a rename there cannot silently orphan a field.
 *
 * This PDF is a paraphrased TDS rather than the official C.A.R. form: the
 * header fields are literal "[City]" / "[County]" / "[Date]" tokens inline in a
 * sentence, so those fields are placed directly over the token.
 */
const TEXT_SLOTS: Array<{
  questionId: string;
  page: number;
  rect: [number, number, number, number];
  /** Inline-in-a-sentence slots need a smaller face or they run into the prose. */
  fontSize?: number;
}> = [
  { questionId: "meta.city", fontSize: 7, page: 0, rect: [490.4, 81.1, 560.0, 93.0] },
  { questionId: "meta.county", fontSize: 7, page: 0, rect: [28.0, 93.3, 100.0, 105.0] },
    // The token sits mid-sentence, but the rest of that line is blank, so the
  // slot runs to the right margin. A full legal description does not fit in
  // the token's own footprint at any readable size.
  { questionId: "meta.property_description", fontSize: 6, page: 0, rect: [346.5, 93.5, 570.0, 105.0] },
  { questionId: "meta.date", fontSize: 6, page: 0, rect: [209.0, 118.5, 246.0, 129.0] },
  { questionId: "meta.units", fontSize: 7, page: 0, rect: [458.0, 71.0, 500.0, 81.5] },
  { questionId: "A.exhaust_fans_location", page: 0, rect: [110.0, 650.0, 192.0, 661.5] },
  { questionId: "A.220_wiring_location", page: 0, rect: [271.0, 650.0, 378.0, 661.5] },
  { questionId: "A.fireplace_location", page: 0, rect: [444.0, 650.0, 575.0, 661.5] },
  { questionId: "A.remote_count", page: 0, rect: [366.0, 587.5, 400.0, 599.0] },
  { questionId: "A.roof", page: 0, rect: [200.0, 658.5, 380.0, 670.0] },
  // Blank band between the "if yes, describe" prompt and the page-2 footnote.
  { questionId: "A.not_operating_describe", page: 0, rect: [37.0, 703.0, 575.0, 722.0] },
  { questionId: "B.other_describe", page: 1, rect: [150.0, 88.0, 565.0, 100.0] },
  { questionId: "B.explain", page: 1, rect: [37.3, 120.0, 575.0, 142.0] },
  { questionId: "C.explain", page: 1, rect: [37.3, 645.0, 575.0, 688.0] },
];

/** A square centred on the glyph — the glyph box carries font leading. */
function area(g: Glyph) {
  const side = g.x1 - g.x0;
  const cx = (g.x0 + g.x1) / 2;
  const cy = (g.y0 + g.y1) / 2;
  return {
    x: (cx - side / 2) / PAGE_W,
    y: (cy - side / 2) / PAGE_H,
    w: side / PAGE_W,
    h: side / PAGE_H,
    // DocuSeal numbers pages from 1; the extractor works in 0-based indexes.
    page: g.page + 1,
  };
}

const fields: Field[] = [];

function pushRect(
  name: string,
  type: Field["type"],
  role: string,
  page: number,
  [x0, y0, x1, y1]: [number, number, number, number],
  fontSize?: number,
) {
  placedNames.add(name);
  fields.push({
    name,
    type,
    role,
    ...(fontSize ? { preferences: { font_size: fontSize } } : {}),
    areas: [
      {
        x: x0 / PAGE_W,
        y: y0 / PAGE_H,
        w: (x1 - x0) / PAGE_W,
        h: (y1 - y0) / PAGE_H,
        page: page + 1,
      },
    ],
  });
}
const claimed = new Set<Glyph>();
const problems: string[] = [];
const warnings: string[] = [];
const placedNames = new Set<string>();

function emit(name: string, g: Glyph) {
  if (claimed.has(g)) return;
  claimed.add(g);
  placedNames.add(name);
  fields.push({ name, type: "checkbox", role: ROLES.SELLER_1, areas: [area(g)] });
}

// 0. Synthesise boxes the PDF is missing, sized like a normal one.
for (const m of MISSING_BOXES) {
  const q = getQuestion(m.questionId);
  if (!q || q.docuseal.kind !== "checkbox") {
    problems.push(`${m.questionId}: expected a checkbox mapping`);
    continue;
  }
  const SIDE = 6.6;
  emit(q.docuseal.field, {
    page: m.page,
    x0: m.x,
    y0: m.y,
    x1: m.x + SIDE,
    y1: m.y + SIDE,
    label: "(synthesised)",
  });
}

// 1. Yes/No rows — matched by position, since every label is just "Yes"/"No".
for (const row of YES_NO_ROWS) {
  const q = getQuestion(row.questionId);
  if (!q || q.docuseal.kind !== "yes_no") {
    problems.push(`${row.questionId}: expected a yes_no mapping`);
    continue;
  }
  const onRow = glyphs
    .filter((g) => g.page === row.page && near(g.y0, row.y))
    .sort((a, b) => a.x0 - b.x0);
  if (onRow.length !== 2) {
    problems.push(`${row.questionId}: found ${onRow.length} boxes at y=${row.y}, expected 2`);
    continue;
  }
  emit(q.docuseal.yesField, onRow[0]);
  emit(q.docuseal.noField, onRow[1]);
}

// 2. Option groups — anchored by row, then matched in reading order.
//
// Deliberately positional rather than by label: the registry's option labels are
// seller-facing ("Yes, I live here") while the form says "is", and matching text
// across that gap is guesswork. Reading order is exact. The label is still
// compared, but only to warn.
for (const group of OPTION_GROUPS) {
  const q = getQuestion(group.questionId);
  if (!q || q.docuseal.kind !== "enum_checkboxes") {
    problems.push(`${group.questionId}: expected an enum_checkboxes mapping`);
    continue;
  }
  const onRows = glyphs
    .filter(
      (g) =>
        g.page === group.page &&
        g.x0 >= group.x[0] &&
        g.x0 <= group.x[1] &&
        group.y.some((y) => near(g.y0, y)),
    )
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);

  const entries = Object.entries(q.docuseal.fields);
  if (onRows.length !== entries.length) {
    problems.push(
      `${group.questionId}: ${onRows.length} boxes for ${entries.length} options`,
    );
    continue;
  }
  entries.forEach(([value, field], i) => {
    const g = onRows[i];
    const label = q.options?.find((o) => o.value === value)?.label ?? value;
    const a = norm(label);
    const b = norm(g.label);
    if (a && b && !a.startsWith(b) && !b.startsWith(a)) {
      warnings.push(
        `${group.questionId}.${value}: registry "${label}" vs form "${g.label.slice(0, 34)}"`,
      );
    }
    emit(field, g);
  });
}

// 3. Plain checkboxes — matched by label.
//
// Exact first, then prefix, longest label first. Order matters: a loose prefix
// match lets "Pool" claim the box belonging to "Pool/Spa Heater".
// 4. Text slots.
for (const slot of TEXT_SLOTS) {
  const q = getQuestion(slot.questionId);
  if (!q) {
    problems.push(`${slot.questionId}: not in the registry`);
    continue;
  }
  const m = q.docuseal;
  const name =
    m.kind === "text" || m.kind === "composed" ? m.field : undefined;
  if (!name) {
    problems.push(`${slot.questionId}: expected a text or composed mapping`);
    continue;
  }
  pushRect(name, "text", ROLES.SELLER_1, slot.page, slot.rect, slot.fontSize);
}

// 5. Header slots that repeat the address and date on pages 2 and 3.
for (const [name, page] of [
  ["property_address_p2", 1],
  ["date_p2", 1],
  ["property_address_p3", 2],
  ["date_p3", 2],
] as const) {
  const rect: [number, number, number, number] = name.startsWith("property")
    ? [110, 18.5, 450, 30.5]
    : [490, 18.5, 575, 30.5];
  pushRect(name, "text", ROLES.SELLER_1, page, rect, 8);
}

// 6. Signatures, dates and initials.
//
// Only the three disclosure-stage roles. The buyer acknowledgement block and
// the selling agent's line are left unassigned: at listing there is no buyer.
const SIGNER_SLOTS: Record<string, { page: number; rect: [number, number, number, number] }> = {
  seller1_signature: { page: 2, rect: [68, 56, 400, 74] },
  seller1_date: { page: 2, rect: [438, 56, 575, 74] },
  seller2_signature: { page: 2, rect: [68, 73, 400, 91] },
  seller2_date: { page: 2, rect: [438, 73, 575, 91] },
  agent_name: { page: 2, rect: [170, 409, 300, 427] },
  agent_signature: { page: 2, rect: [326, 409, 450, 427] },
  agent_date: { page: 2, rect: [479, 409, 575, 427] },
  // Per-page initials exist only on page 1 of this PDF; pages 2 and 3 lost
  // their initials rows in the same regeneration that dropped the checkboxes.
  seller1_initials: { page: 0, rect: [396, 741.5, 432, 752] },
  seller2_initials: { page: 0, rect: [454, 741.5, 490, 752] },
};

for (const signer of SIGNER_FIELDS) {
  const slot = SIGNER_SLOTS[signer.name];
  if (!slot) {
    problems.push(`${signer.name}: no slot on the form`);
    continue;
  }
  pushRect(signer.name, signer.type, signer.role, slot.page, slot.rect);
}

const plain = QUESTIONS.filter((q) => q.docuseal.kind === "checkbox").sort(
  (a, b) => b.label.length - a.label.length,
);

for (const pass of ["exact", "prefix"] as const) {
  for (const q of plain) {
    if (q.docuseal.kind !== "checkbox") continue;
    if (placedNames.has(q.docuseal.field)) continue;

    const wanted = norm(q.label);
    if (wanted.length < 3) continue;

    const hit = glyphs.find((g) => {
      if (claimed.has(g)) return false;
      const got = norm(g.label);
      if (!got) return false;
      return pass === "exact"
        ? got === wanted
        : got.startsWith(wanted) || wanted.startsWith(got);
    });
    if (hit) emit(q.docuseal.field, hit);
  }
}

for (const q of plain) {
  if (q.docuseal.kind !== "checkbox") continue;
  if (!placedNames.has(q.docuseal.field)) {
    problems.push(`${q.id}: no box on the form labelled "${q.label}"`);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const placed = new Set(fields.map((f) => f.name));
const expected = expectedFieldNames();
const missing = expected.filter((n) => !placed.has(n));
const unclaimed = glyphs.filter((g) => !claimed.has(g));

console.log(`glyphs        ${glyphs.length}`);
console.log(`fields placed ${fields.length}`);
console.log(`expected      ${expected.length}\n`);

if (warnings.length) {
  console.log(`label drift, matched by position (${warnings.length}):`);
  warnings.forEach((w) => console.log("  " + w));
  console.log();
}
if (problems.length) {
  console.log(`unresolved (${problems.length}):`);
  problems.forEach((p) => console.log("  " + p));
  console.log();
}
if (unclaimed.length) {
  console.log(`glyphs with no field (${unclaimed.length}):`);
  unclaimed.forEach((g) =>
    console.log(`  p${g.page} y=${g.y0.toFixed(1)} x=${g.x0.toFixed(1)} ${JSON.stringify(g.label.slice(0, 52))}`),
  );
  console.log();
}
console.log(`expected but not placed (${missing.length}):`);
console.log("  " + (missing.join(", ") || "none"));

export { fields };

// ---------------------------------------------------------------------------
// Create it
// ---------------------------------------------------------------------------

if (process.argv.includes("--create")) {
  const { readFileSync: read } = await import("node:fs");
  process.loadEnvFile();

  const key = process.env.DOCUSEAL_API_KEY;
  const base = process.env.DOCUSEAL_BASE_URL;
  if (!key || !base) throw new Error("DOCUSEAL_API_KEY / DOCUSEAL_BASE_URL not set");

    // The prepared base, with the "[City]" style placeholders removed — see
  // scripts/prepare_pdf.py. Geometry still comes from the original; redaction
  // deletes text without moving anything else.
  const pdf = read(new URL("../assets/ca-tds-template.pdf", import.meta.url));

  const response = await fetch(`${base}/templates/pdf`, {
    method: "POST",
    headers: { "X-Auth-Token": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "California TDS",
      documents: [
        { name: "ca-tds", file: pdf.toString("base64"), fields },
      ],
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    console.error(`\nDocuSeal ${response.status}: ${body.slice(0, 600)}`);
    process.exit(1);
  }

  const template = JSON.parse(body);
  const live: string[] = (template.fields ?? []).map((f: { name: string }) => f.name);
  const notInTemplate = expected.filter((n) => !live.includes(n));
  const notInRegistry = live.filter((n) => !expected.includes(n));

  console.log(`\ntemplate #${template.id} "${template.name}" — ${live.length} fields live`);
  console.log(`in registry, missing from template (${notInTemplate.length}): ${notInTemplate.join(", ") || "none"}`);
  console.log(`in template, unknown to registry (${notInRegistry.length}): ${notInRegistry.join(", ") || "none"}`);
  console.log(`\nDOCUSEAL_TDS_TEMPLATE_ID=${template.id}`);
}
