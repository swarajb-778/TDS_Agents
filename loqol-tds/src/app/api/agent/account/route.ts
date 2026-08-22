import { NextResponse } from "next/server";
import { renameAgent } from "@/db/accounts";
import { agentForMutation } from "@/db/guard";

/** The name on the account. Sellers never see it; the agent's own header does. */
export async function PATCH(request: Request) {
  // Authenticated AND the CSRF token echoed back — the existing guard, unchanged.
  const auth = await agentForMutation();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json(
      { fieldErrors: { name: "What should we call you?" } },
      { status: 400 },
    );
  }
  if (name.length > 120) {
    return NextResponse.json(
      { fieldErrors: { name: "That's longer than 120 characters." } },
      { status: 400 },
    );
  }

  await renameAgent(auth.agent.id, name);
  return NextResponse.json({ ok: true, name });
}
