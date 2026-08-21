/**
 * Agent authentication.
 *
 * Stateless signed cookie rather than a sessions table: there is one thing to
 * verify (this agent id, not yet expired, signed by us) and a table would add a
 * round trip to every request for a revocation feature nothing uses yet.
 *
 * Sellers do NOT come through here — they hold a magic link, see requests.ts.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./index";
import { agents } from "./schema";
import { verifyPassword } from "./crypto";

const MAX_AGE_SECONDS = 60 * 60 * 12;

export const SESSION_COOKIE = "loqol_session";
// Names shared with the browser; see src/app/csrf.ts for why they live there.
export { CSRF_COOKIE, CSRF_HEADER } from "../app/csrf";

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set.");
  return value;
}

const sign = (payload: string) =>
  createHmac("sha256", secret()).update(payload).digest("base64url");

export function issueSession(agentId: string): { value: string; maxAge: number } {
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const payload = `${agentId}.${expires}`;
  return { value: `${payload}.${sign(payload)}`, maxAge: MAX_AGE_SECONDS };
}

/** Returns the agent id, or null. Never throws on malformed input. */
export function readSession(cookie: string | undefined): string | null {
  if (!cookie) return null;
  const parts = cookie.split(".");
  if (parts.length !== 3) return null;
  const [agentId, expires, mac] = parts;

  const expected = Buffer.from(sign(`${agentId}.${expires}`));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  if (Number(expires) * 1000 < Date.now()) return null;
  return agentId;
}

export function newCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Double-submit check. The cookie is readable by our own JS, which then echoes
 * it in a header; a cross-site form post cannot set that header.
 */
export function csrfOk(cookie: string | undefined, header: string | null): boolean {
  if (!cookie || !header) return false;
  const a = Buffer.from(cookie);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface AgentIdentity {
  id: string;
  name: string;
  email: string;
}

export async function authenticate(
  email: string,
  password: string,
): Promise<AgentIdentity | null> {
  const [row] = await db
    .select()
    .from(agents)
    .where(eq(agents.email, email.trim().toLowerCase()))
    .limit(1);

  // Same failure for unknown email and wrong password — no account enumeration.
  if (!row) return null;
  if (!verifyPassword(password, row.passwordHash)) return null;
  return { id: row.id, name: row.name, email: row.email };
}

export async function agentById(id: string): Promise<AgentIdentity | null> {
  const [row] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  return row ? { id: row.id, name: row.name, email: row.email } : null;
}
