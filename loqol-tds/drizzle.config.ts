import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile();
} catch {
  // generate/check need no connection; migrate will fail loudly instead
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
