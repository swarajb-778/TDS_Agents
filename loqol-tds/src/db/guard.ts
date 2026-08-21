/**
 * One place that answers "which agent is this, and may they mutate?".
 *
 * Every agent route calls this rather than reading cookies itself — a guard
 * that is easy to forget is a guard that gets forgotten.
 */

import { cookies, headers } from "next/headers";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_COOKIE,
  agentById,
  csrfOk,
  readSession,
  type AgentIdentity,
} from "./auth";

export async function currentAgent(): Promise<AgentIdentity | null> {
  const jar = await cookies();
  const id = readSession(jar.get(SESSION_COOKIE)?.value);
  return id ? agentById(id) : null;
}

/** For mutations: authenticated AND the CSRF token echoed back. */
export async function agentForMutation(): Promise<
  { ok: true; agent: AgentIdentity } | { ok: false; status: number; error: string }
> {
  const agent = await currentAgent();
  if (!agent) return { ok: false, status: 401, error: "Please sign in again." };

  const jar = await cookies();
  const sent = (await headers()).get(CSRF_HEADER);
  if (!csrfOk(jar.get(CSRF_COOKIE)?.value, sent)) {
    return { ok: false, status: 403, error: "Your session expired. Reload and try again." };
  }
  return { ok: true, agent };
}
