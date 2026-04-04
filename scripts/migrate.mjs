import fs from "node:fs";
import path from "node:path";

import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const loadEnvFile = process.loadEnvFile;

const loadLocalEnvFiles = () => {
  const envFiles = [".env", ".env.local"];

  for (const envFile of envFiles) {
    const envPath = path.join(process.cwd(), envFile);

    if (fs.existsSync(envPath)) {
      loadEnvFile?.(envPath);
    }
  }
};

if (!loadEnvFile) {
  throw new Error("Node runtime does not support process.loadEnvFile.");
}

const main = async () => {
  loadLocalEnvFiles();

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run migrations. Set it directly or provide it via .env.");
  }

  const sql = postgres(connectionString, {
    max: 1,
    idle_timeout: 20,
    prepare: false,
  });

  try {
    const db = drizzle(sql);

    await migrate(db, {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });

    console.log("Database migrations completed.");
  } finally {
    await sql.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
