/**
 * Database connection. Supabase Postgres over the session pooler.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Node 26 reads .env natively — no dotenv dependency. Absent in production,
// where the platform injects the environment directly.
try {
  process.loadEnvFile();
} catch {
  // no .env file; fall through to the check below
}

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and paste the Supabase " +
      "session-pooler URI (port 5432).",
  );
}
// A half-filled placeholder otherwise fails much later as an opaque DNS error.
if (url.includes("<")) {
  throw new Error(
    "DATABASE_URL still contains placeholders. Paste the real Supabase " +
      "session-pooler URI (Connect -> ORMs, port 5432) into .env.",
  );
}

/**
 * One pool, reused.
 *
 * Two things bite here. Supabase's session pooler allows 15 clients total, and
 * Next's dev server re-evaluates modules on every hot reload — so a fresh pool
 * per reload exhausts the limit within a few edits. The same shape hurts in
 * production, where each serverless instance opens its own pool against the
 * same 15.
 *
 * So: cap it low, let idle connections go, and hang the client off globalThis
 * so a reload reuses it instead of opening another.
 */
const globalForDb = globalThis as unknown as {
  loqolSql?: ReturnType<typeof postgres>;
};

export const sql =
  globalForDb.loqolSql ??
  postgres(url, {
    // prepare: false is required if this ever points at the transaction pooler
    // (port 6543), and costs nothing on the session pooler.
    prepare: false,
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== "production") globalForDb.loqolSql = sql;

export const db = drizzle(sql, { schema });

/** Scripts need this or the pool keeps the process alive. */
export function closeDb(): Promise<void> {
  return sql.end();
}
