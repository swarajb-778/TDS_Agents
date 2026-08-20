/**
 * Registry integrity check. Must pass before any commit touching src/tds/.
 * Catches dangling gate references, enums without options, duplicate ids,
 * voice-first questions with no voice prompt, and duplicate DocuSeal fields.
 */
import { validateRegistry } from "../src/tds/flow";
import { QUESTIONS } from "../src/tds/registry";
import { expectedFieldNames } from "../src/tds/docuseal";

const errors = [...validateRegistry()];

// A duplicate PDF field name silently overwrites an answer. Catch it here.
const seen = new Map<string, string>();
for (const q of QUESTIONS) {
  const m = q.docuseal;
  const fields =
    m.kind === "yes_no"
      ? [m.yesField, m.noField]
      : m.kind === "enum_checkboxes"
        ? Object.values(m.fields)
        : m.kind === "checkbox" || m.kind === "text" || m.kind === "composed"
          ? [m.field]
          : [];
  for (const f of fields) {
    if (seen.has(f)) errors.push(`Duplicate DocuSeal field "${f}" (${seen.get(f)} and ${q.id})`);
    seen.set(f, q.id);
  }
}

if (errors.length) {
  console.error(`✗ ${errors.length} registry error(s):`);
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}

console.log(`✓ registry valid — ${QUESTIONS.length} questions, ${expectedFieldNames().length} DocuSeal fields`);
