/**
 * End-to-end proof: seeded answers -> DocuSeal submission -> filled PDF.
 *
 * Completes every submitter over the API so a real document is generated. That
 * is a Test Mode convenience — in the product the seller signs it themselves in
 * the embedded form (src/app/s/[token]/sign-chapter.tsx), and the listing agent
 * countersigns in DocuSeal.
 *
 *   npx tsx scripts/fill-pdf.ts "Marcus Oyelaran"
 *   npx tsx scripts/fill-pdf.ts "Marcus Oyelaran" --archive
 *
 * The round trip itself lives in src/tds/docuseal-api.ts so the app and this
 * script cannot drift apart about what a submission looks like.
 */

import { writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../src/db/index";
import { agents, deals } from "../src/db/schema";
import { loadAnswers } from "../src/db/answers";
import { SIGNER_FIELDS, buildSubmission, toFieldValues } from "../src/tds/docuseal";
import {
  archiveSubmission,
  completeSubmitter,
  createSubmission,
  downloadDocument,
  executedDocument,
  requireDocusealConfig,
} from "../src/tds/docuseal-api";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const archive = process.argv.includes("--archive");
const sellerName = args[0] ?? "Marcus Oyelaran";
const { templateId } = requireDocusealConfig();

const [deal] = await db.select().from(deals).where(eq(deals.sellerName, sellerName));
if (!deal) throw new Error(`no deal for ${sellerName}`);
const [agent] = await db.select().from(agents).where(eq(agents.id, deal.agentId));

const answers = await loadAnswers(deal.id);
const values = toFieldValues(answers);
console.log(
  `${sellerName}: ${Object.keys(answers).length} answers -> ${Object.keys(values).length} field values`,
);

const submitters = await createSubmission(
  buildSubmission({
    templateId,
    answers,
    sellers: [{ role: "", name: deal.sellerName, email: deal.sellerEmail }],
    listingAgent: { role: "", name: agent.name, email: agent.email },
    sendEmail: false,
  }),
);

const seller = submitters[0];
console.log(
  `submission ${seller.submission_id}: ${submitters.map((s) => s.role).join(", ")}`,
);

/**
 * Marking a submitter complete is not enough on its own — a signature field
 * with no value stays blank, which is exactly right, and is why this supplies
 * one. In the product every one of these is a person clicking sign.
 */
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

const today = new Date().toISOString().slice(0, 10);

for (const submitter of submitters) {
  const name = submitter.role === "Listing Agent" ? agent.name : deal.sellerName;
  const signerValues: Record<string, string> = {};

  for (const field of SIGNER_FIELDS) {
    if (field.role !== submitter.role) continue;
    signerValues[field.name] =
      field.type === "initials"
        ? initialsOf(name)
        : field.type === "date"
          ? today
          : name;
  }

  await completeSubmitter(submitter.id, signerValues);
  console.log(`  signed as ${submitter.role}: ${Object.keys(signerValues).join(", ")}`);
}

// Rendering is asynchronous: the submission reports completion before the PDF
// exists, so asking once and giving up gets nothing.
const doc = await executedDocument(seller.submission_id, { attempts: 20 });
if (!doc) throw new Error("no document generated");

const pdf = Buffer.from(await downloadDocument(doc.url));
const out = `filled-tds-${sellerName.split(" ")[0].toLowerCase()}.pdf`;
writeFileSync(out, pdf);
console.log(`\nwrote ${out} (${(pdf.length / 1024).toFixed(0)} KB)`);
console.log(doc.url);

// Test Mode fills up with proof runs otherwise. Archiving keeps the record and
// clears the list.
if (archive) {
  await archiveSubmission(seller.submission_id);
  console.log(`archived submission ${seller.submission_id}`);
}

await closeDb();
