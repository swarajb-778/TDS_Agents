/**
 * Seller access. No account, no password — an opaque token from the emailed
 * link, scoped to exactly one deal.
 */

import { eq } from "drizzle-orm";
import { db } from "./index";
import { deals, disclosureRequests } from "./schema";
import { hashToken } from "./crypto";

export interface SellerSession {
  /** The disclosure request — also the actor id on every answer they write. */
  requestId: string;
  dealId: string;
  sellerName: string;
  propertyAddress: string;
}

/**
 * Resolve a magic-link token, or null if it is unknown, revoked, or expired.
 *
 * The lookup is by hash against a unique index, so a leaked database yields no
 * working links and there is no plaintext to compare against.
 */
export async function resolveSellerToken(
  token: string,
): Promise<SellerSession | null> {
  if (!token) return null;

  const rows = await db
    .select({
      requestId: disclosureRequests.id,
      dealId: disclosureRequests.dealId,
      expiresAt: disclosureRequests.expiresAt,
      revokedAt: disclosureRequests.revokedAt,
      sellerName: deals.sellerName,
      propertyAddress: deals.propertyAddress,
    })
    .from(disclosureRequests)
    .innerJoin(deals, eq(deals.id, disclosureRequests.dealId))
    .where(eq(disclosureRequests.tokenHash, hashToken(token)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;

  return {
    requestId: row.requestId,
    dealId: row.dealId,
    sellerName: row.sellerName,
    propertyAddress: row.propertyAddress,
  };
}
