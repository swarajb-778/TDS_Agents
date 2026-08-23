/**
 * The app must import without a database.
 *
 * `next build` imports every route module to collect page data. A throw at
 * module scope therefore fails the build on any machine that has no .env —
 * which is every CI builder, and which is how this shipped broken once. The
 * failure is invisible locally, because locally there is always a .env.
 *
 * So: spawn a probe from a directory with no .env and no DATABASE_URL, and
 * assert the import survives while the first query does not.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dbModule = pathToFileURL(
  path.resolve(import.meta.dirname, "../src/db/index.ts"),
).href;

const cold = mkdtempSync(path.join(tmpdir(), "loqol-coldstart-"));
const probe = path.join(cold, "probe.mts");

writeFileSync(
  probe,
  `const { db } = await import(${JSON.stringify(dbModule)});
console.log("IMPORTED");
try {
  db.select;
  console.log("NO_THROW");
} catch (error) {
  console.log("THREW:" + (error as Error).message);
}
`,
);

// No .env in the probe's cwd, and the variable stripped from the environment.
const env = { ...process.env };
delete env.DATABASE_URL;

// spawnSync, not execFileSync: a probe that crashes is the failure this check
// exists to catch, and it should arrive as the assertion below rather than as
// a stack trace from the spawn itself.
const run = spawnSync("npx", ["tsx", probe], {
  cwd: cold,
  env,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;

assert.match(
  out,
  /IMPORTED/,
  "importing src/db/index without DATABASE_URL threw — next build will fail on CI",
);
console.log("✓ the database module imports with no environment at all");

assert.match(
  out,
  /THREW:DATABASE_URL is not set/,
  "the first query should still fail loudly, and name the variable",
);
console.log("✓ the first query still fails loudly, naming the variable");

console.log("\ncold-start checks passed");
