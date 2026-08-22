/**
 * "Send me a new link."
 *
 * The seller's own escape from an expired or superseded link, and the reason
 * neither of those screens is a dead end.
 *
 * Two properties make this safe to expose to whoever is holding the stale link:
 * the new one goes to the address on the deal and is never in the response, and
 * the endpoint takes no parameters at all — the deal comes from the signed
 * cookie, so there is nothing to point at someone else's disclosure.
 */

import { NextResponse } from "next/server";
import { resendSellerLink } from "@/db/requests";
import { currentSeller, sameOrigin } from "@/db/seller-guard";
import { recordAccountAttempt } from "@/db/rate-limit";

export async function POST(request: Request) {
  if (!(await sameOrigin())) {
    return NextResponse.json({ error: "Reload the page and try again." }, { status: 403 });
  }

  const access = await currentSeller();

  // Only a dead link needs reviving. A live session asking for one would just
  // be revoking itself.
  if (access.outcome !== "expired" && access.outcome !== "revoked") {
    return NextResponse.json(
      { error: "There's nothing to resend from here." },
      { status: 409 },
    );
  }

  // Each press costs an email aimed at an address the presser cannot read, so
  // an unthrottled endpoint is a mail bomb pointed at the seller.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const limit = recordAccountAttempt("seller_relink", access.requestId, ip);
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: `We've already sent one. Give it a few minutes, then try again.`,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const origin = process.env.APP_URL ?? new URL(request.url).origin;
  const sent = await resendSellerLink(access.requestId, origin);
  if (!sent) {
    return NextResponse.json({ error: "Could not send a new link." }, { status: 500 });
  }

  // Masked. Enough for the seller to know which inbox to open, not enough to
  // be worth harvesting.
  return NextResponse.json({ ok: true, sentTo: sent.sentTo });
}
