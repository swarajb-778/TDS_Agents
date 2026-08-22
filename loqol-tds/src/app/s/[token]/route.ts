/**
 * The exchange.
 *
 * This is the only place a magic-link token is ever read. It is spent here for
 * a scoped session cookie and the browser is redirected somewhere that has no
 * token in it — so the credential never reaches browser history, a screenshot
 * of the address bar, or a `Referer` header on the way out.
 *
 * A route handler rather than a page because a Server Component cannot set a
 * cookie. That constraint happens to describe the thing correctly: this is an
 * endpoint that trades one credential for another, not a screen.
 *
 * An HTTP redirect leaves no history entry of its own, so pressing Back from
 * the disclosure does not walk the seller onto the tokenised URL again.
 */

import { NextResponse } from "next/server";
import { resolveSellerToken } from "@/db/requests";
import { currentSeller } from "@/db/seller-guard";
import { SELLER_COOKIE, sessionCookie, sellerCookieOptions } from "@/db/seller-auth";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const access = await resolveSellerToken(token);

  const to = (path: string) =>
    // 303: this was a GET, and the browser should GET the destination.
    NextResponse.redirect(new URL(path, request.url), 303);

  if (access.outcome === "valid" || access.outcome === "submitted") {
    const cookie = sessionCookie(access.session);
    const response = to("/disclosure/welcome");
    response.cookies.set(SELLER_COOKIE, cookie.value, sellerCookieOptions(cookie.maxAge));
    return response;
  }

  /*
   * A dead link, but the browser may already be holding a live session for the
   * same deal — the seller finished the email, got going, then found an older
   * message and clicked that instead. Sending them to a help page at that point
   * would be telling them they are locked out of a session they are sitting in.
   *
   * Same deal only. A dead link for a different property must not drop someone
   * into the disclosure they happen to be signed into.
   */
  const existing = await currentSeller();
  if (
    "session" in existing &&
    "dealId" in access &&
    existing.session.dealId === access.dealId
  ) {
    return to("/disclosure/welcome");
  }

  const response = to("/disclosure/help");
  if ("requestId" in access) {
    /*
     * Expired and revoked get a cookie too. It is a handle, not an authority:
     * it names the request so the help page can say which outcome this is and
     * so "send me a new one" has something to reissue against. What the
     * request is *allowed* to do is re-read from the database on every use, so
     * a cookie minted here grants exactly nothing.
     */
    const cookie = sessionCookie({
      requestId: access.requestId,
      dealId: access.dealId,
      sellerName: "",
      propertyAddress: "",
      // Short-lived: this is scratch state for the help page, not a session.
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    response.cookies.set(SELLER_COOKIE, cookie.value, sellerCookieOptions(cookie.maxAge));
  } else {
    // Nothing recognised the token. Clear whatever stale cookie is there so the
    // help page does not report someone else's outcome.
    response.cookies.delete(SELLER_COOKIE);
  }
  return response;
}
