import { QUESTIONS, CHAPTERS, questionsInChapter, groupsInChapter } from "../src/tds/registry";
import { validateRegistry, nextQuestion, progress, makeAnswer, resume } from "../src/tds/flow";
import { detectConflicts } from "../src/tds/conflicts";
import { toFieldValues, expectedFieldNames } from "../src/tds/docuseal";
import type { AnswerMap } from "../src/tds/types";

const errs = validateRegistry();
console.log("registry errors:", errs.length ? errs : "none");
console.log("questions:", QUESTIONS.length, "| docuseal fields:", expectedFieldNames().length);
for (const c of CHAPTERS) {
  const n = questionsInChapter(c.id).length;
  if (n) console.log(`  ${c.title}: ${n} questions`, groupsInChapter(c.id).length ? `(${groupsInChapter(c.id).length} groups)` : "");
}

const a: AnswerMap = {};
console.log("\nfresh:", nextQuestion(a).question?.id, "|", resume(a).message);

// simulate a partial session
a["occupancy"] = makeAnswer("occupancy", "is", "form");
a["A.public_sewer"] = makeAnswer("A.public_sewer", true, "form");
a["A.septic_tank"] = makeAnswer("A.septic_tank", true, "form");
a["A.sump_pump"] = makeAnswer("A.sump_pump", true, "form");
a["A.pool"] = makeAnswer("A.pool", false, "form");
a["A.garage"] = makeAnswer("A.garage", true, "form");
a["C.13"] = makeAnswer("C.13", true, "voice", { confidence: 0.9, verbatim: "yeah there's an HOA" });
a["C.12"] = makeAnswer("C.12", false, "voice", { confidence: 0.8 });
a["C.8"] = makeAnswer("C.8", false, "voice", { confidence: 0.9 });

const p = progress(a);
console.log("\nprogress:", p.overallPercent + "%", "|", p.label);
p.chapters.forEach(c => console.log(`  ${c.title}: ${c.answered}/${c.total} (${c.state})`));

console.log("\ngated question appears:", nextQuestion(a, "A.garage").question?.id);
console.log("follow-up jumps queue:", nextQuestion(a, "C.13").question?.id);

console.log("\nconflicts:");
detectConflicts(a).forEach(c => console.log(`  [${c.severity}] ${c.ruleId}\n    ${c.message.slice(0, 110)}...`));

console.log("\nrendered fields:", JSON.stringify(toFieldValues(a), null, 0).slice(0, 300));
