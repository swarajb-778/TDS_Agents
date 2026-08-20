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
