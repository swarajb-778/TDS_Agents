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
