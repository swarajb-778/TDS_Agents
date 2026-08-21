import { NextResponse } from "next/server";
import { agentForMutation } from "@/db/guard";
import { createDeal, issueDisclosureLink } from "@/db/deals";
import { writeAnswer } from "@/db/answers";
import { resolveQuestion } from "@/tds/flow";
import type { AnswerValue } from "@/tds/types";

/**
 * Create a deal, prefill the agent-only questions, and issue the magic link.
 *
 * One call, because these are one action: a deal with no link and no property
 * details is not a thing anyone wants.
 */
export async function POST(request: Request) {
  const auth = await agentForMutation();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");
  const sellerName = str("sellerName");
  const sellerEmail = str("sellerEmail");
  const propertyAddress = str("propertyAddress");

  const fieldErrors: Record<string, string> = {};
  if (!sellerName) fieldErrors.sellerName = "Who is the seller?";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sellerEmail)) {
    fieldErrors.sellerEmail = "That doesn't look like an email address.";
  }
  if (!propertyAddress) fieldErrors.propertyAddress = "Which property?";
  if (Object.keys(fieldErrors).length) {
    return NextResponse.json({ fieldErrors }, { status: 400 });
  }

  const dealId = await createDeal(auth.agent.id, { sellerName, sellerEmail, propertyAddress });
  const actor = { type: "agent" as const, id: auth.agent.id };

  // The agent-only answers, filled before the seller ever sees the form.
  const prefill = (body.answers ?? {}) as Record<string, AnswerValue>;
  const rejected: string[] = [];
  for (const [questionId, value] of Object.entries(prefill)) {
    if (!resolveQuestion(questionId)) continue;
    if (value === null || value === "") continue;
    const result = await writeAnswer({
      dealId,
      questionId,
      value,
      source: "agent",
      actor,
    });
    if (!result.ok) rejected.push(questionId);
  }

  const token = await issueDisclosureLink(dealId);
  const base = process.env.APP_URL ?? new URL(request.url).origin;

  return NextResponse.json({ ok: true, dealId, link: `${base}/s/${token}`, rejected });
}
