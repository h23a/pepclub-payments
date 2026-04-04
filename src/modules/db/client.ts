import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getEnv } from "@/modules/config/env";
import { logger } from "@/modules/core/logger";

import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __pepclub_sql: postgres.Sql | undefined;
  // eslint-disable-next-line no-var
  var __pepclub_db: PostgresJsDatabase<typeof schema> | undefined;
}

const sqlClient =
  global.__pepclub_sql ??
  postgres(getEnv().databaseUrl, {
    max: getEnv().nodeEnv === "development" ? 1 : 10,
    idle_timeout: 20,
    prepare: false,
    onnotice: () => {
      return;
    },
  });

const dbInstance = global.__pepclub_db ?? drizzle(sqlClient, { schema });

if (getEnv().nodeEnv !== "production") {
  global.__pepclub_sql = sqlClient;
  global.__pepclub_db = dbInstance;
}

export const sql = sqlClient;
export const db = dbInstance;

export const checkDatabaseConnection = async () => {
  try {
    await sql`select 1`;
    return { ok: true as const };
  } catch (error) {
    logger.error("Database connectivity check failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Unknown database error",
    };
  }
};
