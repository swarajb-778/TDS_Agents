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
  // no .env file; the platform environment is expected to supply DATABASE_URL
}

/**
 * The connection is built on first use, never at import.
 *
 * `next build` imports every route module to collect page data, so a throw at
 * module scope fails the build on a machine that has no database — which is
 * every CI builder. Deferring it means a missing DATABASE_URL surfaces on the
 * first query, at request time, where it is actually a problem.
 */
function connect(): ReturnType<typeof postgres> {
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
  return postgres(url, {
    // prepare: false is required if this ever points at the transaction pooler
    // (port 6543), and costs nothing on the session pooler.
    prepare: false,
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });
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
  loqolDb?: ReturnType<typeof drizzle<typeof schema>>;
};

function real(): ReturnType<typeof drizzle<typeof schema>> {
  if (!globalForDb.loqolDb) {
    globalForDb.loqolSql ??= connect();
    globalForDb.loqolDb = drizzle(globalForDb.loqolSql, { schema });
  }
  return globalForDb.loqolDb;
}

/**
 * ponytail: a Proxy rather than turning 14 call sites into `getDb()`. Every
 * consumer keeps `import { db }` and the laziness stays an implementation
 * detail of this file.
 */
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop, receiver) {
    const instance = real();
    const value = Reflect.get(instance, prop, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

/** Scripts need this or the pool keeps the process alive. */
export async function closeDb(): Promise<void> {
  await globalForDb.loqolSql?.end();
  globalForDb.loqolSql = undefined;
  globalForDb.loqolDb = undefined;
}
