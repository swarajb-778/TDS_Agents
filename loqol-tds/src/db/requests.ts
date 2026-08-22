/**
 * Seller access. No account, no password — an opaque token from the emailed
 * link, scoped to exactly one deal.
 *
 * The token is only ever seen once, at `/s/<token>`, which trades it for a
 * cookie (see seller-auth.ts). Everything after that resolves a request id
 * instead, so both doors come through the same classifier below and cannot
 * disagree about whether a seller is let in.
 */

import { desc, eq } from "drizzle-orm";
import { db } from "./index";
import { agents, deals, disclosureRequests } from "./schema";
import { hashToken } from "./crypto";
import { sendEmail } from "../mail/send";

export interface SellerSession {
  /** The disclosure request — also the actor id on every answer they write. */
  requestId: string;
  dealId: string;
  sellerName: string;
  propertyAddress: string;
  /** When the underlying link dies. Bounds the session cookie's own lifetime. */
  expiresAt: Date;
}

/**
 * Why a seller is, or is not, being let in.
 *
 * Five, because five screens: three of the four old failures were lies and a
 * seller who is told the wrong thing has no working next step.
 *
 * `not_found` deliberately covers *both* an unparseable token and a
 * well-formed one that matches no row. Splitting them would tell a guesser
 * when they had the shape right, which is the only thing a 256-bit token can
 * leak. The other outcomes are only reachable by someone already holding a
 * real token, so naming them costs nothing.
 */
export type SellerOutcome =
  | "valid"
  | "submitted"
  | "expired"
  | "revoked"
  | "not_found";

export type SellerAccess =
  | { outcome: "valid"; session: SellerSession }
  | { outcome: "submitted"; session: SellerSession; submittedAt: Date }
  /** No session, but enough of a handle to reissue against. Never a name. */
  | { outcome: "expired" | "revoked"; requestId: string; dealId: string }
  | { outcome: "not_found" };

const NOT_FOUND = { outcome: "not_found" } as const;

/** Anything the DB will accept as a uuid literal without erroring. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECTION = {
  requestId: disclosureRequests.id,
  dealId: disclosureRequests.dealId,
  expiresAt: disclosureRequests.expiresAt,
  revokedAt: disclosureRequests.revokedAt,
  sellerName: deals.sellerName,
  propertyAddress: deals.propertyAddress,
  submittedAt: deals.submittedAt,
};

type RequestRow = {
  requestId: string;
  dealId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  sellerName: string;
  propertyAddress: string;
  submittedAt: Date | null;
};

/**
 * One place decides what a row means.
 *
 * The order is a product decision, not an implementation detail:
 *
 * - **revoked first.** An agent sending a newer link is a deliberate act, and
 *   it outranks everything. A revoked link never opens a door.
 * - **submitted before expired.** Expiry limits how long a link can be
 *   *written* through. Once the disclosure is in, showing the seller what they
 *   signed carries no new risk, and "this link has expired" would be a dead end
 *   on a deal that is finished.
 */
function classify(row: RequestRow | undefined): SellerAccess {
  if (!row) return NOT_FOUND;

  if (row.revokedAt) {
    return { outcome: "revoked", requestId: row.requestId, dealId: row.dealId };
  }

  const session: SellerSession = {
    requestId: row.requestId,
    dealId: row.dealId,
    sellerName: row.sellerName,
    propertyAddress: row.propertyAddress,
    expiresAt: row.expiresAt,
  };

  if (row.submittedAt) {
    return { outcome: "submitted", session, submittedAt: row.submittedAt };
  }
  if (row.expiresAt.getTime() < Date.now()) {
    return { outcome: "expired", requestId: row.requestId, dealId: row.dealId };
  }
  return { outcome: "valid", session };
}

/**
 * Resolve a magic-link token. Called exactly once per session, by the exchange
 * at `/s/[token]`; after that the seller carries a cookie instead.
 *
 * The lookup is by hash against a unique index, so a leaked database yields no
 * working links and there is no plaintext to compare against.
 */
export async function resolveSellerToken(token: string): Promise<SellerAccess> {
  // A link broken across two lines by a mail client arrives truncated. The
  // shape check only skips a pointless query — the answer is the same either
  // way, which is the point.
  if (!token || token.length > 512) return NOT_FOUND;

  const rows = await db
    .select(SELECTION)
    .from(disclosureRequests)
    .innerJoin(deals, eq(deals.id, disclosureRequests.dealId))
    .where(eq(disclosureRequests.tokenHash, hashToken(token)))
    .limit(1);

  return classify(rows[0]);
}

/**
 * Resolve a request id carried in a session cookie.
 *
 * Re-read on every request rather than trusted from the cookie, because
 * revocation has to bite: an agent who sends a newer link must close the tab
 * the old one opened, not wait fourteen days for a cookie to lapse.
 */
export async function resolveSellerRequest(
  requestId: string,
): Promise<SellerAccess> {
  if (!UUID.test(requestId)) return NOT_FOUND;

  const rows = await db
    .select(SELECTION)
    .from(disclosureRequests)
    .innerJoin(deals, eq(deals.id, disclosureRequests.dealId))
    .where(eq(disclosureRequests.id, requestId))
    .limit(1);

  return classify(rows[0]);
}

/** `m•••@gmail.com` — enough to recognise, not enough to harvest. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "your email";
  return `${local.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(local.length - 1, 5)))}@${domain}`;
}

export interface ResendOutcome {
  /** Where it went, masked, so the page can be specific without printing it. */
  sentTo: string;
}

/**
 * The seller's own way out of a dead link.
 *
 * Safe to expose to whoever is holding the stale link, because the new one is
 * mailed to the address on the deal — never returned in the response. Someone
 * who found an expired link in a forwarded email can cause the real seller to
 * receive a fresh one; they cannot read it. Same shape as every "resend
 * verification email" on the internet.
 *
 * The agent is told, but is *not* sent the link: they do not need it, and a
 * bearer token sitting in a second inbox is twice the exposure for nothing.
 */
export async function resendSellerLink(
  requestId: string,
  origin: string,
): Promise<ResendOutcome | null> {
  if (!UUID.test(requestId)) return null;

  const [row] = await db
    .select({
      dealId: deals.id,
      sellerName: deals.sellerName,
      sellerEmail: deals.sellerEmail,
      propertyAddress: deals.propertyAddress,
      agentName: agents.name,
      agentEmail: agents.email,
    })
    .from(disclosureRequests)
    .innerJoin(deals, eq(deals.id, disclosureRequests.dealId))
    .innerJoin(agents, eq(agents.id, deals.agentId))
    .where(eq(disclosureRequests.id, requestId))
    .limit(1);
  if (!row) return null;

  // Imported lazily: deals.ts pulls in the flow engine for its summaries, and
  // a static import here would make every seller page load carry the registry.
  const { issueDisclosureLink } = await import("./deals");
  const token = await issueDisclosureLink(row.dealId);
  const firstName = row.sellerName.split(" ")[0];

  await sendEmail({
    to: row.sellerEmail,
    subject: "Your disclosure link, refreshed",
    body: [
      `Hi ${firstName},`,
      "",
      `Here is a new link for the disclosure on ${row.propertyAddress}.`,
      "Everything you already answered is still saved.",
      "",
      `${origin}/s/${token}`,
      "",
      "The old link no longer works. This one lasts two weeks.",
      "",
      `— ${row.agentName}`,
    ].join("\n"),
  });

  await sendEmail({
    to: row.agentEmail,
    subject: `${row.sellerName} asked for a new disclosure link`,
    body: [
      `${row.sellerName} tried an old link for ${row.propertyAddress}.`,
      "",
      "A fresh one has been emailed to them and the old one is revoked.",
      "Nothing is needed from you unless they say it did not arrive.",
    ].join("\n"),
  });

  return { sentTo: maskEmail(row.sellerEmail) };
}

/** Newest-first, for the agent's view of a deal's link history. */
export async function requestsForDeal(dealId: string) {
  return db
    .select()
    .from(disclosureRequests)
    .where(eq(disclosureRequests.dealId, dealId))
    .orderBy(desc(disclosureRequests.sentAt));
}
