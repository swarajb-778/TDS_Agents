/**
 * DocuSeal over the wire.
 *
 * Kept apart from `docuseal.ts`, which is a pure function over the answer set
 * and gets imported by anything that needs a field name. This module holds the
 * API key and therefore must never end up in a client bundle — every caller is
 * a route handler, a server component, or a script.
 *
 * The round trip here is the one `scripts/fill-pdf.ts` proved on the command
 * line: build a submission from the registry mapping, POST it, and read the
 * executed document back off the submission. That script now calls these
 * functions rather than keeping a second copy of them.
 */

import type { FieldValues, SubmissionPayload } from "./docuseal";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface DocusealConfig {
  key: string;
  base: string;
  templateId: number;
}

/**
 * Read the environment at call time, not at import time.
 *
 * A module-level throw would take down every page that merely imports something
 * from this file, including the seller's interview, which does not need
 * DocuSeal at all until the very last screen.
 */
export function docusealConfig(): DocusealConfig | null {
  const key = process.env.DOCUSEAL_API_KEY;
  const base = process.env.DOCUSEAL_BASE_URL;
  const templateId = Number(process.env.DOCUSEAL_TDS_TEMPLATE_ID);
  if (!key || !base || !templateId) return null;
  return { key, base: base.replace(/\/$/, ""), templateId };
}

/** Same config, but for callers that genuinely cannot continue without it. */
export function requireDocusealConfig(): DocusealConfig {
  const config = docusealConfig();
  if (!config) {
    throw new Error(
      "DOCUSEAL_API_KEY, DOCUSEAL_BASE_URL and DOCUSEAL_TDS_TEMPLATE_ID must all be set.",
    );
  }
  return config;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const { key, base } = requireDocusealConfig();
  const res = await fetch(base + path, {
    ...init,
    headers: { "X-Auth-Token": key, "Content-Type": "application/json" },
    cache: "no-store",
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`DocuSeal ${res.status} on ${path}: ${body.slice(0, 400)}`);
  }
  return JSON.parse(body) as T;
}

// ---------------------------------------------------------------------------
// Shapes — only the fields this app actually reads
// ---------------------------------------------------------------------------

export interface DocusealDocument {
  name: string;
  url: string;
}

export interface DocusealSubmitter {
  id: number;
  submission_id: number;
  role: string;
  slug: string;
  /** The public signing URL, e.g. https://docuseal.com/s/X2AsCtFG7RyoPE */
  embed_src: string;
  status: "awaiting" | "sent" | "opened" | "completed" | "declined" | "expired";
  completed_at: string | null;
  declined_at: string | null;
}

export interface DocusealSubmission {
  id: number;
  submitters: DocusealSubmitter[];
  documents?: DocusealDocument[];
  audit_log_url?: string | null;
  archived_at?: string | null;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

/**
 * Create a submission and return its submitters in the order they were posted,
 * so `[0]` is Seller 1.
 *
 * DocuSeal answers this call with either a bare array of submitters or an
 * object wrapping one, depending on the endpoint version. Both are handled
 * because the difference is invisible until it isn't.
 */
export async function createSubmission(
  payload: SubmissionPayload,
): Promise<DocusealSubmitter[]> {
  const created = await api<DocusealSubmitter[] | { submitters: DocusealSubmitter[] }>(
    "/submissions",
    { method: "POST", body: JSON.stringify(payload) },
  );
  return Array.isArray(created) ? created : created.submitters;
}

export function getSubmission(submissionId: number): Promise<DocusealSubmission> {
  return api<DocusealSubmission>(`/submissions/${submissionId}`);
}

/** Archives rather than deletes — DocuSeal keeps the record either way. */
export function archiveSubmission(submissionId: number): Promise<unknown> {
  return api(`/submissions/${submissionId}`, { method: "DELETE" });
}

/**
 * Sign on a submitter's behalf. Test Mode only — in the product every one of
 * these is a person clicking a button in the embedded form.
 */
export function completeSubmitter(
  submitterId: number,
  values: FieldValues,
): Promise<DocusealSubmitter> {
  return api<DocusealSubmitter>(`/submitters/${submitterId}`, {
    method: "PUT",
    body: JSON.stringify({ completed: true, values }),
  });
}

/**
 * The executed PDF, if DocuSeal has finished rendering it.
 *
 * Rendering is asynchronous: the submission reports completion before the
 * document exists, so a caller that asks once and gives up gets nothing. Poll
 * rather than assume.
 */
export async function executedDocument(
  submissionId: number,
  { attempts = 1, delayMs = 1500 } = {},
): Promise<DocusealDocument | null> {
  for (let i = 0; i < attempts; i++) {
    const submission = await getSubmission(submissionId);
    const doc = submission.documents?.[0];
    if (doc) return doc;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

/**
 * Fetch the bytes of a rendered document.
 *
 * The URL DocuSeal hands back is a short-lived signed link, which is why it is
 * never stored: it is resolved fresh on each download and the bytes are
 * streamed through this app so the seller's browser never has to hold it.
 */
export async function downloadDocument(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`DocuSeal document ${res.status}`);
  return res.arrayBuffer();
}
