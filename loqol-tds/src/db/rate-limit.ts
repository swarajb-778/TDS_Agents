/**
 * Login throttling.
 *
 * Two windows, both cooldowns rather than locks. A permanent lock keyed on a
 * known email is a free denial-of-service against a named agent: anyone can
 * lock them out of their own account by failing five times on purpose.
 *
 * ponytail: in-memory, so the budget is per server instance. Correct for one
 * deployable and honest about its ceiling — behind several instances an
 * attacker gets the limit times the instance count. Move the map to Redis when
 * there is more than one.
 */

const WINDOW_MS = 15 * 60 * 1000;

/** Per email: tight, because this is the credential-stuffing target. */
const PER_EMAIL = 5;
/** Per IP: looser, since an office of agents shares one address. */
const PER_IP = 20;

type Hit = { count: number; firstAt: number };
const buckets = new Map<string, Hit>();

function bump(key: string, limit: number, now: number): number {
  const hit = buckets.get(key);
  if (!hit || now - hit.firstAt > WINDOW_MS) {
    buckets.set(key, { count: 1, firstAt: now });
    return 0;
  }
  hit.count += 1;
  if (hit.count <= limit) return 0;
  return Math.ceil((hit.firstAt + WINDOW_MS - now) / 1000);
}

export interface RateVerdict {
  ok: boolean;
  retryAfterSeconds: number;
}

/**
 * Call once per attempt, before checking the password. Both windows advance so
 * neither can be starved by spending the other.
 */
export function recordLoginAttempt(email: string, ip: string): RateVerdict {
  const now = Date.now();
  // Sweep expired buckets so a long-running process does not grow forever.
  if (buckets.size > 5_000) {
    for (const [k, v] of buckets) if (now - v.firstAt > WINDOW_MS) buckets.delete(k);
  }
  const byEmail = bump(`e:${email.trim().toLowerCase()}`, PER_EMAIL, now);
  const byIp = bump(`i:${ip}`, PER_IP, now);
  const retryAfterSeconds = Math.max(byEmail, byIp);
  return { ok: retryAfterSeconds === 0, retryAfterSeconds };
}

/** A correct password clears the email's budget — they are who they said. */
export function clearLoginAttempts(email: string): void {
  buckets.delete(`e:${email.trim().toLowerCase()}`);
}

/*
 * The other doors into an account: signup, "email me a reset link", and the
 * reset form itself.
 *
 * Tighter than login, for a different reason. Login costs an attacker nothing
 * but a request; these three each cost us an email, so an unlimited reset
 * endpoint is a mail bomb aimed at whichever address the attacker names — and
 * a signup endpoint with no ceiling is a way to fill the agents table.
 *
 * Same two windows, same cooldown-not-lock rule, keyed per action so spending
 * the signup budget cannot lock anyone out of a password reset.
 */
const PER_EMAIL_SLOW = 3;
const PER_IP_SLOW = 15;

/**
 * Call once per attempt, before doing any work the caller could measure.
 *
 * `action` namespaces the buckets; `email` may be any identifier for the target
 * of the request (an address, or a token holder's address once resolved).
 */
export function recordAccountAttempt(
  action: string,
  email: string,
  ip: string,
): RateVerdict {
  const now = Date.now();
  const byEmail = bump(`${action}:e:${email.trim().toLowerCase()}`, PER_EMAIL_SLOW, now);
  const byIp = bump(`${action}:i:${ip}`, PER_IP_SLOW, now);
  const retryAfterSeconds = Math.max(byEmail, byIp);
  return { ok: retryAfterSeconds === 0, retryAfterSeconds };
}

/** Test seam: the checks in scripts/db-check.ts need a clean window. */
export function clearAccountAttempts(action: string, email: string): void {
  buckets.delete(`${action}:e:${email.trim().toLowerCase()}`);
}
