/**
 * End-to-end proof: seeded answers -> DocuSeal submission -> filled PDF.
 *
 * Completes the submitter over the API so a real document is generated. That is
 * a Test Mode convenience — in the product the seller signs it themselves.
 *
 *   npx tsx scripts/fill-pdf.ts "Marcus Oyelaran"
 */

import { writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../src/db/index";
import { agents, deals } from "../src/db/schema";
import { loadAnswers } from "../src/db/answers";
import { SIGNER_FIELDS, buildSubmission, toFieldValues } from "../src/tds/docuseal";

const sellerName = process.argv[2] ?? "Marcus Oyelaran";
const key = process.env.DOCUSEAL_API_KEY!;
const base = process.env.DOCUSEAL_BASE_URL!;
const templateId = Number(process.env.DOCUSEAL_TDS_TEMPLATE_ID);
if (!templateId) throw new Error("DOCUSEAL_TDS_TEMPLATE_ID not set");

async function api(path: string, init?: RequestInit) {
  const res = await fetch(base + path, {
    ...init,
    headers: { "X-Auth-Token": key, "Content-Type": "application/json" },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`DocuSeal ${res.status} on ${path}: ${body.slice(0, 400)}`);
  return JSON.parse(body);
}

const [deal] = await db.select().from(deals).where(eq(deals.sellerName, sellerName));
if (!deal) throw new Error(`no deal for ${sellerName}`);
const [agent] = await db.select().from(agents).where(eq(agents.id, deal.agentId));

const answers = await loadAnswers(deal.id);
const values = toFieldValues(answers);
console.log(`${sellerName}: ${Object.keys(answers).length} answers -> ${Object.keys(values).length} field values`);

const payload = buildSubmission({
  templateId,
  answers,
  sellers: [{ role: "", name: deal.sellerName, email: deal.sellerEmail }],
  listingAgent: { role: "", name: agent.name, email: agent.email },
  sendEmail: false,
});

const created = await api("/submissions", {
  method: "POST",
  body: JSON.stringify(payload),
});

const submitters: Array<{ id: number; submission_id: number; role: string }> =
  Array.isArray(created) ? created : created.submitters;
const seller = submitters[0];
console.log(
  `submission ${seller.submission_id}: ${submitters.map((s) => s.role).join(", ")}`,
);

/**
 * Test Mode: sign on each submitter's behalf so DocuSeal renders an executed
 * document. Marking a submitter complete is not enough — a signature field with
 * no value stays blank, which is exactly right, and is why this has to supply
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

  await api(`/submitters/${submitter.id}`, {
    method: "PUT",
    body: JSON.stringify({ completed: true, values: signerValues }),
  });
  console.log(`  signed as ${submitter.role}: ${Object.keys(signerValues).join(", ")}`);
}

let docs: Array<{ name: string; url: string }> = [];
for (let i = 0; i < 20 && docs.length === 0; i++) {
  const s = await api(`/submissions/${seller.submission_id}`);
  docs = s.documents ?? [];
  if (docs.length === 0) await new Promise((r) => setTimeout(r, 1500));
}
if (docs.length === 0) throw new Error("no document generated");

const pdf = Buffer.from(await (await fetch(docs[0].url)).arrayBuffer());
const out = `filled-tds-${sellerName.split(" ")[0].toLowerCase()}.pdf`;
writeFileSync(out, pdf);
console.log(`\nwrote ${out} (${(pdf.length / 1024).toFixed(0)} KB)`);
console.log(docs[0].url);

await closeDb();
