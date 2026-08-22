/**
 * Persistence for the TDS.
 *
 * `src/tds/` is a pure library over an in-memory `AnswerMap`. This is the only
 * place that knows about rows. Nothing here redefines a question — question
 * ids are plain text and are validated against the registry on write.
 */

import {
  pgTable,
  uuid,
  text,
  jsonb,
  integer,
  real,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AnswerStatus, AnswerValue, Modality } from "../tds/types";

/** Who caused a write. `source` says which modality; this says which person. */
export type ActorType = "seller" | "agent" | "system";

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deals = pgTable("deals", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  sellerName: text("seller_name").notNull(),
  sellerEmail: text("seller_email").notNull(),
  propertyAddress: text("property_address").notNull(),
  // ponytail: no status column. "not started" vs "in progress" is derivable
  // from progress(loadAnswers(id)); only submission is a real event, so only
  // submission gets stored. A status column would be a second source of truth
  // that can disagree with the answers it claims to summarise.
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The seller's magic link. No account, no password — an opaque high-entropy
 * token, stored only as a hash, scoped to exactly one deal.
 */
export const disclosureRequests = pgTable("disclosure_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  dealId: uuid("deal_id")
    .notNull()
    .references(() => deals.id, { onDelete: "cascade" }),
  /** SHA-256 of the token. The plaintext exists only in the emailed link. */
  tokenHash: text("token_hash").notNull().unique(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  // ponytail: revoked/expired/active is a function of these two timestamps and
  // the clock. Reissuing is "insert a new row, set revoked_at on the old one".
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Current answer state. One row per (deal, question) — this is what
 * `loadAnswers()` turns into an `AnswerMap` for the flow engine.
 *
 * ponytail: `text().$type<...>()` rather than pgEnum. AnswerStatus and Modality
 * are declared in src/tds/types.ts; a pgEnum copies those values into a second
 * place that needs its own migration to change. The only writer is
 * writeAnswer(), which validates against the registry first.
 */
export const answers = pgTable(
  "answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    value: jsonb("value").$type<AnswerValue>(),
    status: text("status").$type<AnswerStatus>().notNull(),
    source: text("source").$type<Modality>().notNull(),
    /** Voice only. Below CONFIDENCE_THRESHOLD the write never gets this far. */
    confidence: real("confidence"),
    /** Voice only. What the seller actually said. */
    verbatim: text("verbatim"),
    note: text("note"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("answers_deal_question_idx").on(t.dealId, t.questionId)],
);

/**
 * Append-only audit trail. Never updated, never deleted.
 *
 * The TDS is signed under penalty of perjury. "Who set this answer, when, from
 * which modality, and what did they actually say" is not optional, and the
 * current-state row above can only hold the latest of each.
 */
export const answerEvents = pgTable(
  "answer_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    value: jsonb("value").$type<AnswerValue>(),
    status: text("status").$type<AnswerStatus>().notNull(),
    source: text("source").$type<Modality>().notNull(),
    confidence: real("confidence"),
    verbatim: text("verbatim"),
    note: text("note"),
    actorType: text("actor_type").$type<ActorType>().notNull(),
    actorId: text("actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("answer_events_deal_question_idx").on(t.dealId, t.questionId)],
);

/**
 * A conflict the seller looked at and stood by.
 *
 * "You said no pool earlier but mentioned a shared pool just now" can be a real
 * contradiction or a real situation. The seller owns this document, so a seller
 * who says both answers are right is allowed to be right — we record that they
 * were asked and what they said, and stop bringing it up.
 */
export const conflictAcknowledgements = pgTable(
  "conflict_acknowledgements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    /** The rule id from src/tds/conflicts.ts. */
    ruleId: text("rule_id").notNull(),
    /** Whatever the seller said about it, if anything. */
    note: text("note"),
    actorType: text("actor_type").$type<ActorType>().notNull(),
    actorId: text("actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("conflict_ack_deal_rule_idx").on(t.dealId, t.ruleId)],
);

/**
 * Per-deal session preferences.
 *
 * ponytail: no last_question_id. resume() derives position from the answer set
 * (src/tds/flow.ts) — "position is derived, not stored" is already the
 * documented decision. Storing it creates a second source of truth that drifts
 * the moment a seller answers from the other modality.
 */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  dealId: uuid("deal_id")
    .notNull()
    .unique()
    .references(() => deals.id, { onDelete: "cascade" }),
  /** Which path the seller was last on, so re-entry lands where they left. */
  modality: text("modality").$type<Modality>().notNull().default("form"),
  /** Per-question modality overrides. Modality is a default, not a jail. */
  overrides: jsonb("overrides").$type<Record<string, Modality>>().notNull().default({}),
  /** Voice transcript. Written by the voice path (task 4). */
  transcript: jsonb("transcript").$type<unknown[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Why a one-time link was issued. Same lifecycle, two different doors. */
export type AgentTokenPurpose = "sign_in" | "password_reset";

/**
 * One-time links for the agent side: the sign-in link a new signup is emailed,
 * and the password-reset link. Same shape as the seller's magic link — 256 bits
 * from the CSPRNG, stored only as a SHA-256 hash (see crypto.ts for why a KDF
 * would be the wrong tool on a token with nothing to guess).
 *
 * ponytail: no status column, matching disclosure_requests. Live / used /
 * expired is a function of consumed_at, expires_at and the clock. Redeeming a
 * token sets consumed_at; so does changing the password, which is how an
 * outstanding reset link dies the moment it stops being the only way in.
 */
export const agentTokens = pgTable(
  "agent_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    purpose: text("purpose").$type<AgentTokenPurpose>().notNull(),
    /** SHA-256 of the token. The plaintext exists only in the emailed link. */
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_tokens_agent_idx").on(t.agentId)],
);

/**
 * A DocuSeal submission for a deal — the signable document, and what became of
 * it.
 *
 * ponytail: still no status column. "not sent / awaiting signature / signed" is
 * a function of whether a row exists and whether completed_at is set, and the
 * authority on the middle state is DocuSeal itself, which is polled. What gets
 * stored is only what this app cannot re-derive: which submission belongs to
 * which deal, and the seller's own timestamps.
 *
 * A row per submission rather than columns on `deals`, because a deal can
 * legitimately have more than one over its life: a seller who spots a mistake
 * after signing gets a fresh link and signs again, and the superseded document
 * still exists and still needs to be findable.
 *
 * NOT here: the buyer's acknowledgement of receipt. That is a second submission
 * against the same template, created at offer time with the Buyer 1 / Buyer 2
 * roles that `docuseal.ts` leaves deliberately unassigned. It would attach as
 * another row on this table with a `purpose` discriminator. Out of scope: at
 * disclosure time there is no buyer.
 */
export const signings = pgTable(
  "signings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    /** DocuSeal's submission id. The webhook arrives carrying this and nothing
     *  else this app can trust, so it is the join key. */
    submissionId: integer("submission_id").notNull(),
    /** Seller 1's submitter id, so a completion for the countersigning agent is
     *  never mistaken for the seller signing. */
    submitterId: integer("submitter_id").notNull(),
    /** Seller 1's public signing URL. Not a secret to the seller — it is their
     *  own document — but it is scoped to one submitter and one submission. */
    embedSrc: text("embed_src").notNull(),
    /** When the seller finished signing. `deals.submitted_at` mirrors this;
     *  this one says which document they signed. */
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /**
     * The seller remembering something at 11pm, after signing.
     *
     * A signed legal document is never edited, so this changes nothing about
     * the document. It flags the deal for the agent, who issues a fresh request.
     * Whether it is still outstanding is derived: it is, until a disclosure
     * request is issued after this timestamp.
     */
    changeRequestedAt: timestamp("change_requested_at", { withTimezone: true }),
    changeNote: text("change_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("signings_submission_idx").on(t.submissionId),
    index("signings_deal_idx").on(t.dealId),
  ],
);
