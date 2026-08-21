import { NextResponse } from "next/server";
import { agentForMutation } from "@/db/guard";
import { dealForAgent, issueDisclosureLink } from "@/db/deals";

/** Reissue a magic link. Revokes any live one, so only ever one link works. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await agentForMutation();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const deal = await dealForAgent(id, auth.agent.id);
  if (!deal) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const token = await issueDisclosureLink(id);
  const base = process.env.APP_URL ?? new URL(request.url).origin;
  return NextResponse.json({ ok: true, link: `${base}/s/${token}` });
}
