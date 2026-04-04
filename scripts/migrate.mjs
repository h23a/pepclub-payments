import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import postgres from "postgres";

const loadEnvFile = process.loadEnvFile;
const migrationsSchema = "drizzle";
const migrationsTable = "__drizzle_migrations";

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

const readMigrations = async (migrationsFolder) => {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");

  if (!fs.existsSync(journalPath)) {
    throw new Error(`Can't find ${journalPath}.`);
  }

  const journal = JSON.parse(await fsPromises.readFile(journalPath, "utf8"));

  return Promise.all(
    journal.entries.map(async (entry) => {
      const migrationPath = path.join(migrationsFolder, `${entry.tag}.sql`);
      const query = await fsPromises.readFile(migrationPath, "utf8");

      return {
        folderMillis: entry.when,
        hash: crypto.createHash("sha256").update(query).digest("hex"),
        sql: query
          .split("--> statement-breakpoint")
          .map((statement) => statement.trim())
          .filter(Boolean),
      };
    })
  );
};

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
    const migrations = await readMigrations(path.join(process.cwd(), "drizzle"));

    await sql.unsafe(`create schema if not exists "${migrationsSchema}"`);
    await sql.unsafe(`
      create table if not exists "${migrationsSchema}"."${migrationsTable}" (
        id serial primary key,
        hash text not null,
        created_at bigint
      )
    `);

    const [lastMigration] = await sql`
      select created_at
      from drizzle.__drizzle_migrations
      order by created_at desc
      limit 1
    `;

    await sql.begin(async (transaction) => {
      for (const migration of migrations) {
        if (lastMigration && Number(lastMigration.created_at) >= migration.folderMillis) {
          continue;
        }

        for (const statement of migration.sql) {
          await transaction.unsafe(statement);
        }

        await transaction`
          insert into drizzle.__drizzle_migrations ("hash", "created_at")
          values (${migration.hash}, ${migration.folderMillis})
        `;
      }
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
