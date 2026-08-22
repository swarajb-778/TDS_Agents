/**
 * The two flows that must not reveal whether an account exists: signing up, and
 * asking for a reset link.
 *
 * Both live here rather than in their route handlers, and both return `void`.
 * That is the whole design. A route cannot leak a fact it was never handed —
 * with nothing to branch on, "same status, same body, same headers" stops being
 * a discipline the next person has to remember and becomes the only thing the
 * code can express.
 *
 * It also makes the property testable without a browser or a running server:
 * scripts/db-check.ts calls these directly and asserts on the mail outbox.
 */

import { TOKEN_TTL_MINUTES, issueAgentToken } from "./agent-tokens";
import { agentByEmail, normalizeEmail, registerAgent } from "./accounts";
import { sendPasswordReset, sendSignInLink, sendSignupCollision } from "../mail/auth-mail";

export interface SignUpInput {
  email: string;
  name: string;
  password: string;
}

/**
 * Create the account if the address is free; either way, send mail and say
 * nothing.
 *
 * The asymmetry is pushed entirely into the mailbox, which is the one channel
 * only the address owner can read:
 *
 *   free  → the account exists now, and a one-time link signs them in.
 *   taken → nothing changed, and the owner is told someone tried, with a link
 *           to sign in or reset instead.
 *
 * Both branches pay for one scrypt hash (see registerAgent) so the two are not
 * distinguishable by a stopwatch either.
 */
export async function signUp(input: SignUpInput, origin: string): Promise<void> {
  const email = normalizeEmail(input.email);
  const outcome = await registerAgent({ ...input, email });

  if (outcome.created) {
    const token = await issueAgentToken(outcome.agent.id, "sign_in");
    await sendSignInLink(
      email,
      outcome.agent.name,
      `${origin}/agent/sign-in/${token}`,
      TOKEN_TTL_MINUTES,
    );
    return;
  }

  await sendSignupCollision(email, `${origin}/agent/login`, `${origin}/agent/forgot-password`);
}

/**
 * Mail a reset link, if there is anywhere to mail it.
 *
 * No `else`. An address with no account gets nothing: a "you have no account
 * here" email is the same leak through a slower channel, and it turns one
 * person's typo into someone else's spam.
 */
export async function requestPasswordReset(email: string, origin: string): Promise<void> {
  const agent = await agentByEmail(email);
  if (!agent) return;

  const token = await issueAgentToken(agent.id, "password_reset");
  await sendPasswordReset(
    agent.email,
    agent.name,
    `${origin}/agent/reset-password/${token}`,
    TOKEN_TTL_MINUTES,
  );
}
