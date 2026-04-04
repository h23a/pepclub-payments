import { APL, AuthData } from "@saleor/app-sdk/APL";
import { eq } from "drizzle-orm";

import { db } from "@/modules/db/client";
import { saleorAppAuth } from "@/modules/db/schema";

export class PostgresAPL implements APL {
  async get(saleorApiUrl: string): Promise<AuthData | undefined> {
    const record = await db.query.saleorAppAuth.findFirst({
      where: eq(saleorAppAuth.saleorApiUrl, saleorApiUrl),
    });

    if (!record) {
      return undefined;
    }

    return {
      saleorApiUrl: record.saleorApiUrl,
      token: record.token,
      appId: record.appId,
      jwks: record.jwks ?? undefined,
    };
  }

  async set(authData: AuthData): Promise<void> {
    await db
      .insert(saleorAppAuth)
      .values({
        saleorApiUrl: authData.saleorApiUrl,
        token: authData.token,
        appId: authData.appId,
        jwks: authData.jwks,
      })
      .onConflictDoUpdate({
        target: saleorAppAuth.saleorApiUrl,
        set: {
          token: authData.token,
          appId: authData.appId,
          jwks: authData.jwks,
          updatedAt: new Date(),
        },
      });
  }

  async delete(saleorApiUrl: string): Promise<void> {
    await db.delete(saleorAppAuth).where(eq(saleorAppAuth.saleorApiUrl, saleorApiUrl));
  }

  async getAll(): Promise<AuthData[]> {
    const rows = await db.select().from(saleorAppAuth);

    return rows.map((row) => ({
      saleorApiUrl: row.saleorApiUrl,
      token: row.token,
      appId: row.appId,
      jwks: row.jwks ?? undefined,
    }));
  }
}
