/**
 * The signature step, persisted.
 *
 * Everything the seller and the agent see about signing is derived from three
 * things: whether a `signings` row exists, whether it has a `completed_at`, and
 * what DocuSeal says right now. There is no status column, because a status
 * column is a claim this app would have to keep true about a document it does
 * not own.
 *
 * DocuSeal tells us about completion twice — once by webhook, once when we ask.
 * Both land in `recordCompletion()`, which is idempotent. The webhook is the
 * fast path; asking is the one that works on a laptop with no public URL, and
 * the one that survives a webhook that never arrives.
 */

import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "./index";
import { agents, deals, disclosureRequests, signings } from "./schema";
import { loadAnswers } from "./answers";
import { buildSubmission } from "../tds/docuseal";
import {
  archiveSubmission,
  createSubmission,
  docusealConfig,
  downloadDocument,
  executedDocument,
  getSubmission,
  requireDocusealConfig,
} from "../tds/docuseal-api";

/** What the seller's document is doing, as far as this app can tell. */
export type SigningState = "unsent" | "awaiting_signature" | "signed";

export interface Signing {
  id: string;
  dealId: string;
  submissionId: number;
  submitterId: number;
  /** Seller 1's signing URL — what the embedded form is pointed at. */
  embedSrc: string;
  completedAt: Date | null;
  changeRequestedAt: Date | null;
  changeNote: string | null;
  createdAt: Date;
}

/** Everything both surfaces need about the signature step, in one shape. */
export interface SigningStatus {
  state: SigningState;
  /** False when DocuSeal is not configured at all. Nothing else works, and a
   *  blank screen is a worse answer than saying so. */
  configured: boolean;
  signing: Signing | null;
  signedAt: Date | null;
  /** Outstanding only. A change request the agent has already acted on — by
   *  issuing a fresh link — is history, and derived as such. */
  changeRequest: { at: Date; note: string | null } | null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type Row = typeof signings.$inferSelect;

function toSigning(row: Row): Signing {
  return {
    id: row.id,
    dealId: row.dealId,
    submissionId: row.submissionId,
    submitterId: row.submitterId,
    embedSrc: row.embedSrc,
    completedAt: row.completedAt,
    changeRequestedAt: row.changeRequestedAt,
    changeNote: row.changeNote,
    createdAt: row.createdAt,
  };
}

/** The document currently in play for a deal. Older ones stay for the record. */
export async function latestSigning(dealId: string): Promise<Signing | null> {
  const [row] = await db
    .select()
    .from(signings)
    .where(eq(signings.dealId, dealId))
    .orderBy(desc(signings.createdAt))
    .limit(1);
  return row ? toSigning(row) : null;
}

/**
 * Is the seller's "I need to change something" still waiting on the agent?
 *
 * Derived, not stored: it is outstanding until a disclosure request is issued
 * after they asked. Issuing that link is the agent acting on it, so there is no
 * second button to forget to press and no flag that can sit stale.
 */
async function outstandingChangeRequest(
  signing: Signing | null,
): Promise<{ at: Date; note: string | null } | null> {
  if (!signing?.changeRequestedAt) return null;
  const [later] = await db
    .select({ id: disclosureRequests.id })
    .from(disclosureRequests)
    .where(
      and(
        eq(disclosureRequests.dealId, signing.dealId),
        gt(disclosureRequests.sentAt, signing.changeRequestedAt),
        isNull(disclosureRequests.revokedAt),
      ),
    )
    .limit(1);
  if (later) return null;
  return { at: signing.changeRequestedAt, note: signing.changeNote };
}

export interface SigningParties {
  sellerName: string;
  /** Prefills the embedded form so the seller is not asked who they are. */
  sellerEmail: string;
  propertyAddress: string;
  /** Named on the terminal screen: "what happens next" needs a person in it. */
  agentName: string;
}

export async function signingParties(dealId: string): Promise<SigningParties | null> {
  const [row] = await db
    .select({
      sellerName: deals.sellerName,
      sellerEmail: deals.sellerEmail,
      propertyAddress: deals.propertyAddress,
      agentName: agents.name,
    })
    .from(deals)
    .innerJoin(agents, eq(agents.id, deals.agentId))
    .where(eq(deals.id, dealId))
    .limit(1);
  return row ?? null;
}

export async function signingStatus(dealId: string): Promise<SigningStatus> {
  const signing = await latestSigning(dealId);
  return {
    state: !signing ? "unsent" : signing.completedAt ? "signed" : "awaiting_signature",
    configured: docusealConfig() !== null,
    signing,
    signedAt: signing?.completedAt ?? null,
    changeRequest: await outstandingChangeRequest(signing),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Record a submission this app just created. Separate from `startSigning()` so
 * the persistence half is testable without reaching the network.
 */
export async function recordSigningStarted(
  dealId: string,
  submission: { submissionId: number; submitterId: number; embedSrc: string },
): Promise<Signing> {
  const [row] = await db
    .insert(signings)
    .values({ dealId, ...submission })
    .onConflictDoUpdate({
      target: signings.submissionId,
      set: { submitterId: submission.submitterId, embedSrc: submission.embedSrc },
    })
    .returning();
  return toSigning(row);
}

/**
 * The seller finished signing.
 *
 * Idempotent, and deliberately so: DocuSeal retries webhooks for 48 hours, and
 * this app also polls. The first timestamp wins — a later delivery must not
 * move the moment a legal document was executed.
 */
export async function recordCompletion(
  submissionId: number,
  completedAt: Date,
): Promise<Signing | null> {
  const [row] = await db
    .update(signings)
    .set({ completedAt })
    .where(and(eq(signings.submissionId, submissionId), isNull(signings.completedAt)))
    .returning();

  // Already recorded. Report the existing row rather than nothing, so a caller
  // cannot mistake "seen this before" for "unknown submission".
  if (!row) {
    const [existing] = await db
      .select()
      .from(signings)
      .where(eq(signings.submissionId, submissionId))
      .limit(1);
    return existing ? toSigning(existing) : null;
  }

  await db
    .update(deals)
    .set({ submittedAt: completedAt, updatedAt: new Date() })
    .where(and(eq(deals.id, row.dealId), isNull(deals.submittedAt)));

  return toSigning(row);
}

/**
 * "I need to change something."
 *
 * A seller remembers the water heater at 11pm, after signing. This does not
 * touch the document — a signed disclosure is never edited, and offering to
 * would be the single worst thing this system could do. It tells the agent,
 * who reissues. Without it the seller emails their agent in a panic and the
 * problem leaves the product instead of getting solved.
 */
export async function requestChange(
  dealId: string,
  note: string | null,
): Promise<Signing | null> {
  const signing = await latestSigning(dealId);
  if (!signing) return null;

  const [row] = await db
    .update(signings)
    .set({ changeRequestedAt: new Date(), changeNote: note?.trim() || null })
    .where(eq(signings.id, signing.id))
    .returning();

  await db.update(deals).set({ updatedAt: new Date() }).where(eq(deals.id, dealId));
  return row ? toSigning(row) : null;
}

// ---------------------------------------------------------------------------
// DocuSeal round trip
// ---------------------------------------------------------------------------

/**
 * Build the seller's document and hand back where to sign it.
 *
 * Idempotent by design. A seller who reloads, or taps the button twice on a bad
 * connection, must not end up with two disclosures against one property — so an
 * unfinished signing is reused rather than replaced.
 *
 * Note what is NOT created here: the buyer's acknowledgement of receipt. That
 * is a second submission against the same template with the Buyer 1 / Buyer 2
 * roles `docuseal.ts` leaves unassigned, created at offer time when a buyer
 * exists. It would attach as another `startSigning`-shaped call from the
 * agent's side. Deliberately out of scope: a TDS is completed at listing.
 */
export async function startSigning(dealId: string): Promise<Signing | null> {
  const existing = await latestSigning(dealId);
  if (existing && !existing.completedAt) return existing;
  if (existing?.completedAt) return existing;

  const { templateId } = requireDocusealConfig();

  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!deal) return null;
  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, deal.agentId))
    .limit(1);
  if (!agent) return null;

  const answers = await loadAnswers(dealId);

  const submitters = await createSubmission(
    buildSubmission({
      templateId,
      answers,
      // One seller for now. A co-seller becomes a second entry here and a
      // second submitter; DECISIONS.md §9 records that they answer as one voice.
      sellers: [{ role: "", name: deal.sellerName, email: deal.sellerEmail }],
      listingAgent: { role: "", name: agent.name, email: agent.email },
      // The seller is about to sign in front of us. Emailing them a link to do
      // the thing they are already doing is how a disclosure gets signed twice.
      sendEmail: false,
    }),
  );

  const seller = submitters[0];
  if (!seller) return null;

  return recordSigningStarted(dealId, {
    submissionId: seller.submission_id,
    submitterId: seller.id,
    embedSrc: seller.embed_src,
  });
}

/**
 * Ask DocuSeal what actually happened, and reconcile.
 *
 * This is the reason the product does not depend on webhook delivery. It runs
 * on the seller's polling status call and on the agent's deal page, and it
 * swallows its own failures: DocuSeal being unreachable must degrade to "what
 * we last knew", never to an error page over someone's signed disclosure.
 */
export async function refreshSigning(dealId: string): Promise<SigningStatus> {
  const status = await signingStatus(dealId);
  if (!status.signing || status.signing.completedAt || !status.configured) {
    return status;
  }

  try {
    const submission = await getSubmission(status.signing.submissionId);
    const seller = submission.submitters.find(
      (s) => s.id === status.signing!.submitterId,
    );
    if (seller?.completed_at) {
      await recordCompletion(status.signing.submissionId, new Date(seller.completed_at));
      return signingStatus(dealId);
    }
  } catch {
    // Keep what we last knew. The webhook is the other half of this.
  }
  return status;
}

export interface ExecutedDocument {
  filename: string;
  bytes: ArrayBuffer;
}

/**
 * The executed PDF, fetched fresh.
 *
 * The URL DocuSeal returns is short-lived and signed, so it is resolved per
 * download rather than stored — and the bytes come back through this app so
 * neither surface ever needs the API key or a third-party link that expires
 * between rendering a page and clicking it.
 */
export async function executedPdf(
  dealId: string,
  sellerName: string,
): Promise<ExecutedDocument | null> {
  const signing = await latestSigning(dealId);
  if (!signing || !docusealConfig()) return null;

  const doc = await executedDocument(signing.submissionId);
  if (!doc) return null;

  const safe = sellerName.replace(/[^\w\s-]/g, "").trim() || "seller";
  return {
    filename: `Disclosure - ${safe}.pdf`,
    bytes: await downloadDocument(doc.url),
  };
}

/** Used by scripts to clean up after themselves. Archives, never deletes. */
export async function archiveSigning(signing: Signing): Promise<void> {
  await archiveSubmission(signing.submissionId);
  await db.delete(signings).where(eq(signings.id, signing.id));
}
