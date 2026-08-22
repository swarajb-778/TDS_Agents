/**
 * One place that answers "which disclosure is this browser holding, and may it
 * still be written to?".
 *
 * Mirrors db/guard.ts for the agent side, and stays a separate module for the
 * same reason the cookies are separate: nothing here can accidentally satisfy
 * an agent check, because nothing here returns an agent.
 */

import { cookies, headers } from "next/headers";
import { resolveSellerRequest, type SellerAccess, type SellerSession } from "./requests";
import { SELLER_COOKIE, readSellerSession } from "./seller-auth";

/**
 * The current seller, or why not.
 *
 * The cookie only names a disclosure request; whether that request is live is
 * re-read from the database every time. That extra lookup is what makes
 * revocation immediate — an agent sending a newer link closes the tab the old
 * one opened, rather than waiting for a cookie to lapse.
 */
export async function currentSeller(): Promise<SellerAccess> {
  const jar = await cookies();
  const claim = readSellerSession(jar.get(SELLER_COOKIE)?.value);
  if (!claim) return { outcome: "not_found" };

  const access = await resolveSellerRequest(claim.requestId);

  // The deal is signed into the cookie as well as looked up, so this can only
  // disagree if a request were re-parented between deals. It cannot be, but a
  // guard that costs one comparison and closes a whole class of bug is worth
  // keeping honest.
  if ("session" in access && access.session.dealId !== claim.dealId) {
    return { outcome: "not_found" };
  }
  return access;
}

/**
 * Same-origin check for seller mutations.
 *
 * SameSite=Lax already withholds the session cookie from cross-site POSTs, so
 * this is belt and braces. It fails closed only when a browser actually sent a
 * foreign Origin — a request with no Origin at all (curl, a same-origin GET) is
 * allowed through, because absence is not evidence.
 */
export async function sameOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === h.get("host");
  } catch {
    return false;
  }
}

export type SellerMutation =
  | { ok: true; session: SellerSession }
  | { ok: false; status: number; error: string };

/**
 * For writes.
 *
 * Two things beyond "are they signed in":
 *
 * - **Origin**, per `sameOrigin` above.
 * - **Submitted.** A signed disclosure is read-only, so an answer write is
 *   refused once it has gone in. This is the only place the seller is ever
 *   stopped, and it is not a validation gate — the document is finished, and
 *   letting an edit land silently after signing would be worse than saying so.
 *
 * `allowSubmitted` is for the routes that legitimately serve a finished
 * disclosure: fetching the signed copy, and "I need to change something", which
 * flags the deal rather than editing it.
 */
export async function sellerForMutation(
  { allowSubmitted = false }: { allowSubmitted?: boolean } = {},
): Promise<SellerMutation> {
  if (!(await sameOrigin())) {
    return { ok: false, status: 403, error: "Reload the page and try again." };
  }

  const access = await currentSeller();

  if (access.outcome === "submitted") {
    if (allowSubmitted) return { ok: true, session: access.session };
    return {
      ok: false,
      status: 409,
      error: "This disclosure has already gone to your agent. Ask them to reopen it.",
    };
  }
  if (access.outcome !== "valid") {
    return { ok: false, status: 401, error: "This link is no longer valid." };
  }

  return { ok: true, session: access.session };
}

/** For reads. Same resolution, no Origin or submitted check. */
export async function sellerForRead(): Promise<SellerMutation> {
  const access = await currentSeller();
  if (access.outcome !== "valid" && access.outcome !== "submitted") {
    return { ok: false, status: 401, error: "This link is no longer valid." };
  }
  return { ok: true, session: access.session };
}
