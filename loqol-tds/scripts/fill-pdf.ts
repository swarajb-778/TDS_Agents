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
import { buildSubmission, toFieldValues } from "../src/tds/docuseal";

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

const submitters = Array.isArray(created) ? created : created.submitters;
const seller = submitters[0];
console.log(`submission ${seller.submission_id}, submitter ${seller.id}`);

// Test Mode: complete it so DocuSeal renders the document.
await api(`/submitters/${seller.id}`, {
  method: "PUT",
  body: JSON.stringify({ completed: true }),
});

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
