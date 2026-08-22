import { QUESTIONS, CHAPTER_ORDER } from "../src/tds/registry";
for (const c of CHAPTER_ORDER) {
  const qs = QUESTIONS.filter(q => q.chapter === c);
  console.log(`\n## ${c} (${qs.length})`);
  for (const q of qs) {
    console.log(`  ${q.id} [${q.type}] mod=${q.defaultModality} req=${q.required} gate=${q.gatedBy ? q.gatedBy.questionId + JSON.stringify({e:q.gatedBy.equals,i:q.gatedBy.includes,t:q.gatedBy.isTruthy}) : "-"} fu=${q.followUp ? JSON.stringify(q.followUp.when) : "-"} est=${q.estimatedSeconds}`);
  }
}
