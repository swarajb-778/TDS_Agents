/**
 * One-time links for the agent side — the sign-in link a new signup gets, and
 * the password-reset link.
 *
 * Same shape as the seller's magic link and deliberately the same primitives:
 * `mintSellerToken()` for 256 bits from the CSPRNG and `hashToken()` for the
 * SHA-256 that is all we store. Inventing a second token scheme for the same
 * job is how one of them ends up weaker than the other.
 */

import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "./index";
import { agentTokens, agents, type AgentTokenPurpose } from "./schema";
import { hashToken, mintSellerToken } from "./crypto";

/**
 * Short-lived on purpose. A reset link is a bearer credential for the whole
 * account sitting in a mailbox, which is exactly the thing an attacker with
 * stale inbox access is looking for. Thirty minutes is long enough to walk to
 * a laptop and short enough that yesterday's mail is worthless.
 */
export const TOKEN_TTL_MINUTES = 30;

export interface TokenHolder {
  tokenId: string;
  agentId: string;
  email: string;
  name: string;
}

/** Mint, store the hash, and hand back the only copy of the plaintext. */
export async function issueAgentToken(
  agentId: string,
  purpose: AgentTokenPurpose,
): Promise<string> {
  const token = mintSellerToken();
  await db.insert(agentTokens).values({
    agentId,
    purpose,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000),
  });
  return token;
}

/**
 * Look, without spending it.
 *
 * The reset page needs to know whether to render a form or an "this link has
 * expired" message, and doing that by consuming the token would burn it on the
 * page load — including on the preview fetch some mail clients make.
 */
export async function resolveAgentToken(
  token: string,
  purpose: AgentTokenPurpose,
): Promise<TokenHolder | null> {
  if (!token) return null;

  const rows = await db
    .select({
      tokenId: agentTokens.id,
      agentId: agentTokens.agentId,
      email: agents.email,
      name: agents.name,
    })
    .from(agentTokens)
    .innerJoin(agents, eq(agents.id, agentTokens.agentId))
    .where(
      and(
        eq(agentTokens.tokenHash, hashToken(token)),
        eq(agentTokens.purpose, purpose),
        isNull(agentTokens.consumedAt),
        gt(agentTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Spend it. Returns the holder exactly once, ever.
 *
 * The consume and the check are one UPDATE rather than a read followed by a
 * write: two tabs opening the same link at the same moment would both pass a
 * separate read, and "single use" that loses a race is not single use.
 */
export async function redeemAgentToken(
  token: string,
  purpose: AgentTokenPurpose,
): Promise<TokenHolder | null> {
  if (!token) return null;

  const claimed = await db
    .update(agentTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(agentTokens.tokenHash, hashToken(token)),
        eq(agentTokens.purpose, purpose),
        isNull(agentTokens.consumedAt),
        gt(agentTokens.expiresAt, new Date()),
      ),
    )
    .returning({ tokenId: agentTokens.id, agentId: agentTokens.agentId });

  const row = claimed[0];
  if (!row) return null;

  const [agent] = await db
    .select({ email: agents.email, name: agents.name })
    .from(agents)
    .where(eq(agents.id, row.agentId))
    .limit(1);
  if (!agent) return null;

  return { ...row, email: agent.email, name: agent.name };
}

/**
 * Cancel every live token for an agent.
 *
 * Called whenever the password changes, from either direction. An outstanding
 * reset link is a second key to the account; someone who has just proven they
 * hold the first one should not discover later that an old email still opens
 * the door — and if the change was made by an attacker, the owner's own reset
 * link must not be the thing that quietly re-locks them out.
 */
export async function consumeAgentTokens(agentId: string): Promise<number> {
  const consumed = await db
    .update(agentTokens)
    .set({ consumedAt: new Date() })
    .where(and(eq(agentTokens.agentId, agentId), isNull(agentTokens.consumedAt)))
    .returning({ id: agentTokens.id });
  return consumed.length;
}
