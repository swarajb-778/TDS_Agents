/**
 * The seller's session cookie.
 *
 * The magic-link token is a bearer credential for one deal's answers, and for
 * as long as it lives in the address bar it also lives in browser history, in
 * every screenshot the seller sends their spouse, and in the `Referer` on any
 * outbound link. So `/s/[token]` spends the token once and hands back this
 * cookie; every route after that reads the cookie and the URL carries nothing.
 *
 * WHY THIS CANNOT BE CONFUSED WITH THE AGENT SESSION (db/auth.ts)
 *
 *   1. Different cookie name. The agent guard reads `loqol_session` and only
 *      `loqol_session`; this is `loqol_seller`. Neither guard looks at the
 *      other's jar entry.
 *   2. Different payload arity. The agent cookie is `id.expires.mac` and its
 *      reader rejects anything that is not exactly three dot-separated parts.
 *      This one is `s1.requestId.dealId.expires.mac` — five. Pasting either
 *      value into the other's slot fails before any crypto runs.
 *   3. Different MAC input. Both HMAC over AUTH_SECRET, but everything signed
 *      here is prefixed with a role-and-version label that the agent signer
 *      never emits. Even if the shapes collided, a signature minted for one
 *      role would not verify for the other. That is the property that matters:
 *      names and arity are conventions, this is arithmetic.
 *
 * And this cookie is a *handle*, not an authority. It says which disclosure
 * request the browser is holding; whether that request is still live is
 * re-read from the database on every use (see resolveSellerRequest). A cookie
 * cannot outlive a revocation.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { SellerSession } from "./requests";

export const SELLER_COOKIE = "loqol_seller";

/**
 * Role and version, signed as the first field rather than merely prefixed to
 * the cookie string — a tag outside the MAC is decoration.
 */
const TAG = "s1";
const DOMAIN = "loqol.seller.v1";

/** Ceiling, matching the longest a magic link is ever issued for. */
const MAX_AGE_SECONDS = 14 * 24 * 60 * 60;
/**
 * Floor. A submitted disclosure can sit behind a link that has already lapsed;
 * the read-only view of what they signed still has to survive a refresh. Safe
 * because the database, not the cookie, decides what the session may do.
 */
const MIN_AGE_SECONDS = 60 * 60;

function secret(): string {
  // Deliberately the same secret as the agent session. Rotating AUTH_SECRET
  // should sign everyone out at once; the separation between the two roles is
  // the domain label below, not a second key to lose.
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set.");
  return value;
}

const sign = (payload: string) =>
  createHmac("sha256", secret()).update(`${DOMAIN}\n${payload}`).digest("base64url");

export interface SellerClaim {
  requestId: string;
  /**
   * The one deal this cookie can ever reach. Signed alongside the request id,
   * so it cannot be repointed at another deal without breaking the MAC.
   */
  dealId: string;
}

export interface IssuedCookie {
  value: string;
  maxAge: number;
}

/**
 * Mint a cookie for one disclosure request on one deal.
 *
 * `linkExpiresAt` bounds it: the cookie must never be the reason a link
 * outlives its own expiry date.
 */
export function issueSellerSession(
  claim: SellerClaim,
  linkExpiresAt: Date,
): IssuedCookie {
  const remaining = Math.floor((linkExpiresAt.getTime() - Date.now()) / 1000);
  const maxAge = Math.min(MAX_AGE_SECONDS, Math.max(MIN_AGE_SECONDS, remaining));

  const expires = Math.floor(Date.now() / 1000) + maxAge;
  const payload = `${TAG}.${claim.requestId}.${claim.dealId}.${expires}`;
  return { value: `${payload}.${sign(payload)}`, maxAge };
}

/** Convenience: the same, from a resolved session. */
export function sessionCookie(session: SellerSession): IssuedCookie {
  return issueSellerSession(
    { requestId: session.requestId, dealId: session.dealId },
    session.expiresAt,
  );
}

/**
 * Read a seller cookie. Returns null on anything it does not like, and never
 * throws — this parses attacker-controlled bytes on every request.
 */
export function readSellerSession(cookie: string | undefined): SellerClaim | null {
  if (!cookie) return null;

  const parts = cookie.split(".");
  if (parts.length !== 5) return null;
  const [tag, requestId, dealId, expires, mac] = parts;
  if (tag !== TAG) return null;

  const expected = Buffer.from(sign(`${tag}.${requestId}.${dealId}.${expires}`));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  // A signed-but-stale cookie is still stale. The database check that follows
  // would catch a revoked link but not a lapsed cookie.
  const at = Number(expires);
  if (!Number.isFinite(at) || at * 1000 < Date.now()) return null;

  return { requestId, dealId };
}

/** Same flags as the agent session: httpOnly, Secure in production, Lax. */
export function sellerCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    /*
     * Lax, not Strict, because the seller arrives by clicking a link in their
     * email — a Strict cookie would not be sent on that first navigation and
     * the redirect would land them straight back on the help page.
     *
     * Lax is also what stands in for a CSRF token here. It withholds the
     * cookie entirely from cross-site POSTs, and every seller mutation is a
     * JSON POST, which is preflighted rather than simple. The mutation guard
     * checks Origin on top of that.
     */
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
