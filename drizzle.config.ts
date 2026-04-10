import fs from "node:fs";
import path from "node:path";

import { defineConfig } from "drizzle-kit";

const loadEnvFile = (process as NodeJS.Process & { loadEnvFile?: (path?: string) => void }).loadEnvFile;

for (const envFile of [".env", ".env.local"]) {
  const envPath = path.join(process.cwd(), envFile);

  if (fs.existsSync(envPath)) {
    loadEnvFile?.(envPath);
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to run Drizzle commands.");
}

export default defineConfig({
  schema: "./src/modules/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
});
