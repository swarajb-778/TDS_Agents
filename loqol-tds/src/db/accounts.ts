/**
 * Agent accounts: creating one, renaming one, changing its password.
 *
 * Reading credentials lives in auth.ts and stays there. This is the write side,
 * and it exists so the routes above it stay thin enough that the one property
 * that matters — that signup behaves identically whether or not the address is
 * taken — can be read off a single function.
 */

import { eq } from "drizzle-orm";
import { db } from "./index";
import { agents } from "./schema";
import { hashPassword, verifyPassword } from "./crypto";
import { consumeAgentTokens } from "./agent-tokens";
import type { AgentIdentity } from "./auth";

/** One spelling of an address, everywhere. Stored lowercase, matched lowercase. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type RegisterOutcome =
  | { created: true; agent: AgentIdentity }
  | { created: false };

export interface RegisterInput {
  email: string;
  name: string;
  password: string;
}

/**
 * Create an account if that address is free.
 *
 * Two deliberate choices, both about not leaking whether it was:
 *
 * 1. The password is hashed before the row is attempted, not after the lookup
 *    says the address is free. scrypt is the most expensive thing either branch
 *    does; skipping it on the taken branch would make a taken address answer
 *    measurably faster, which is the same oracle the login path takes the
 *    trouble to close with a decoy hash. Both branches pay for one hash.
 *
 * 2. Existence is decided by the unique index via ON CONFLICT DO NOTHING, not
 *    by a SELECT first. A read-then-write leaves a window in which two signups
 *    for the same address both see it free, and the loser gets a raw constraint
 *    violation — a 500 where the whole point was a uniform 200.
 *
 * The caller gets a boolean it must not turn into a status code. It picks which
 * message to email and returns the same response either way.
 */
export async function registerAgent(input: RegisterInput): Promise<RegisterOutcome> {
  const email = normalizeEmail(input.email);
  const passwordHash = hashPassword(input.password);

  const inserted = await db
    .insert(agents)
    .values({ email, name: input.name.trim(), passwordHash })
    .onConflictDoNothing({ target: agents.email })
    .returning({ id: agents.id, name: agents.name, email: agents.email });

  const row = inserted[0];
  return row ? { created: true, agent: row } : { created: false };
}

/** For the reset request. Null is not an error and must not read as one. */
export async function agentByEmail(email: string): Promise<AgentIdentity | null> {
  const [row] = await db
    .select({ id: agents.id, name: agents.name, email: agents.email })
    .from(agents)
    .where(eq(agents.email, normalizeEmail(email)))
    .limit(1);
  return row ?? null;
}

/** Settings: the name on the account, which is what sellers never see anyway. */
export async function renameAgent(agentId: string, name: string): Promise<void> {
  await db.update(agents).set({ name: name.trim() }).where(eq(agents.id, agentId));
}

/** The current-password check that guards a change from inside a live session. */
export async function passwordMatches(agentId: string, password: string): Promise<boolean> {
  const [row] = await db
    .select({ passwordHash: agents.passwordHash })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!row) return false;
  return verifyPassword(password, row.passwordHash);
}

/**
 * Set a new password and cancel every outstanding one-time link.
 *
 * The cancellation is not housekeeping. A reset link that survives a password
 * change is a second key to the account sitting in a mailbox — the exact thing
 * someone changing their password after a scare is trying to get rid of.
 */
export async function changePassword(agentId: string, password: string): Promise<void> {
  await db
    .update(agents)
    .set({ passwordHash: hashPassword(password) })
    .where(eq(agents.id, agentId));
  await consumeAgentTokens(agentId);
}

/**
 * The shape check, not a validity claim.
 *
 * Deliberately the same permissive pattern the deal route uses: anything
 * stricter rejects real addresses, and the only test that proves an address
 * exists is sending mail to it — which is what these flows do anyway.
 */
export function looksLikeEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
}
