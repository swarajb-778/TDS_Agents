/**
 * Proving a webhook is really from DocuSeal.
 *
 * An unauthenticated POST that marks a disclosure signed is a forged signature
 * on a document executed under penalty of perjury. So this fails closed: with
 * no secret configured, nothing is accepted, and the route says so rather than
 * quietly trusting the internet.
 *
 * DocuSeal offers two mechanisms (Console -> Webhooks -> Security), and this
 * accepts either, preferring the stronger:
 *
 *   1. HMAC. Every request carries `X-Docuseal-Signature: <timestamp>.<hex>`,
 *      an HMAC-SHA256 over `${timestamp}.${rawBody}` keyed with the `whsec_...`
 *      secret from the HMAC tab. The timestamp is inside the signed content, so
 *      a captured request cannot be replayed past the freshness window.
 *   2. A shared secret header, from the Secret tab — an arbitrary key/value
 *      pair added to every notification. Weaker: it is a bearer token repeated
 *      on every call and it says nothing about the body. Supported because it
 *      is the only option on some self-hosted versions.
 *
 * A secret path segment was the fallback the task allowed if neither existed.
 * It is not needed, and would have been worse than both: URLs end up in logs.
 *
 * Pure and side-effect free so `scripts/db-check.ts` can exercise the reject
 * path without a server.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-docuseal-signature";

/** DocuSeal's own tolerance, from their published verification snippet. */
const FRESHNESS_SECONDS = 300;

export type WebhookVerdict =
  | { ok: true; via: "hmac" | "shared_secret" }
  | { ok: false; status: 401 | 503; reason: string };

export interface WebhookSecrets {
  /** The `whsec_...` value from the HMAC tab. */
  hmac?: string;
  /** The key/value pair from the Secret tab. */
  headerName?: string;
  headerValue?: string;
}

export function webhookSecrets(): WebhookSecrets {
  return {
    hmac: process.env.DOCUSEAL_WEBHOOK_SECRET || undefined,
    headerName: process.env.DOCUSEAL_WEBHOOK_HEADER?.toLowerCase() || undefined,
    headerValue: process.env.DOCUSEAL_WEBHOOK_HEADER_VALUE || undefined,
  };
}

/** Constant time, and safe on differing lengths — timingSafeEqual throws. */
function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyWebhook(
  headers: Headers,
  rawBody: string,
  secrets: WebhookSecrets = webhookSecrets(),
  now: number = Date.now(),
): WebhookVerdict {
  const hasShared = Boolean(secrets.headerName && secrets.headerValue);
  if (!secrets.hmac && !hasShared) {
    return {
      ok: false,
      status: 503,
      reason:
        "No DocuSeal webhook secret configured. Set DOCUSEAL_WEBHOOK_SECRET " +
        "(Console -> Webhooks -> Security -> HMAC).",
    };
  }

  if (secrets.hmac) {
    const header = headers.get(SIGNATURE_HEADER);
    if (!header) return { ok: false, status: 401, reason: "Missing signature." };

    const dot = header.indexOf(".");
    if (dot < 1) return { ok: false, status: 401, reason: "Malformed signature." };
    const timestamp = header.slice(0, dot);
    const signature = header.slice(dot + 1);

    const seconds = Number(timestamp);
    if (!Number.isFinite(seconds)) {
      return { ok: false, status: 401, reason: "Malformed signature." };
    }
    // Replay guard. The timestamp is covered by the HMAC, so it cannot be
    // edited to make a captured request look fresh.
    if (Math.abs(now / 1000 - seconds) > FRESHNESS_SECONDS) {
      return { ok: false, status: 401, reason: "Stale signature." };
    }

    const expected = createHmac("sha256", secrets.hmac)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");
    if (!sameSecret(expected, signature)) {
      return { ok: false, status: 401, reason: "Bad signature." };
    }
    return { ok: true, via: "hmac" };
  }

  const sent = headers.get(secrets.headerName!);
  if (!sent || !sameSecret(secrets.headerValue!, sent)) {
    return { ok: false, status: 401, reason: "Bad secret." };
  }
  return { ok: true, via: "shared_secret" };
}

/** Sign a body the way DocuSeal does. Used by the checks, not by the app. */
export function signWebhook(
  rawBody: string,
  secret: string,
  atMs: number = Date.now(),
): string {
  const timestamp = Math.floor(atMs / 1000).toString();
  const mac = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return `${timestamp}.${mac}`;
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

/** Only the fields this app acts on. Everything else on the wire is ignored. */
export interface FormCompletedEvent {
  submissionId: number;
  /** The submitter who completed — not necessarily the seller. */
  submitterId: number;
  role: string;
  completedAt: Date;
}

/**
 * Narrow an untrusted body to the one event this endpoint acts on.
 *
 * `form.completed` fires once per party, so the countersigning agent produces
 * one too. Deciding which is the seller is not this function's job — the caller
 * matches `submitterId` against the row it stored, which is the only claim in
 * here that cannot be forged into meaning something else.
 */
export function parseFormCompleted(body: unknown): FormCompletedEvent | null {
  if (typeof body !== "object" || body === null) return null;
  const event = body as Record<string, unknown>;
  if (event.event_type !== "form.completed") return null;

  const data = event.data;
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;

  const submissionId = Number(d.submission_id);
  const submitterId = Number(d.id);
  if (!Number.isInteger(submissionId) || !Number.isInteger(submitterId)) return null;

  // DocuSeal sends completed_at on this event; the event timestamp is the
  // fallback, and the clock is the last resort. All three beat refusing to
  // record a signature that demonstrably happened.
  const stamp =
    (typeof d.completed_at === "string" && d.completed_at) ||
    (typeof event.timestamp === "string" && event.timestamp) ||
    "";
  const completedAt = stamp ? new Date(stamp) : new Date();

  return {
    submissionId,
    submitterId,
    role: typeof d.role === "string" ? d.role : "",
    completedAt: Number.isNaN(completedAt.getTime()) ? new Date() : completedAt,
  };
}
