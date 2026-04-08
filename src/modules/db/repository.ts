import { and, asc, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";

import { PersistenceError } from "@/modules/core/errors";
import { logger } from "@/modules/core/logger";
import {
  ComplianceContract,
  FinalizationState,
  PaymentAppSettingsInput,
  PaymentProviderKey,
  PaymentSessionRecord,
  PaymentSessionSourceObjectType,
  SaleorPaymentStatus,
} from "@/modules/payments/types";
import { normalizePaymentCountryRestrictions } from "@/modules/payments/country-restrictions";

import { db } from "./client";
import { appSettings, paymentSessionEvents, paymentSessions } from "./schema";

type UpsertPaymentSessionInput = {
  id: string;
  saleorApiUrl: string;
  saleorTransactionId: string;
  saleorTransactionToken?: string | null;
  saleorPspReference?: string | null;
  saleorMerchantReference: string;
  saleorSourceObjectType: "CHECKOUT" | "ORDER";
  saleorSourceObjectId: string;
  checkoutId?: string | null;
  orderId?: string | null;
  customerEmail?: string | null;
  channelSlug?: string | null;
  provider: PaymentProviderKey;
  providerPaymentId?: string | null;
  providerInvoiceId?: string | null;
  providerReferenceId?: string | null;
  providerStatus: string;
  saleorStatus: SaleorPaymentStatus;
  amount: number;
  currency: string;
  hostedUrl?: string | null;
  redirectUrl?: string | null;
  idempotencyKey: string;
  lastWebhookPayload?: unknown;
  complianceContract?: ComplianceContract | null;
  safeErrorSummary?: string | null;
  statusReason?: string | null;
  finalizationState: FinalizationState;
  processedAt?: Date | null;
};

type AppendPaymentSessionEventInput = {
  id: string;
  paymentSessionId: string;
  saleorApiUrl: string;
  source: "saleor" | "provider" | "system";
  eventType: string;
  dedupeKey: string;
  providerEventId?: string | null;
  providerStatus?: string | null;
  saleorStatus?: SaleorPaymentStatus | null;
  message?: string | null;
  payload?: unknown;
};

const mapPaymentSession = (
  row: typeof paymentSessions.$inferSelect
): PaymentSessionRecord => ({
  ...row,
  amount: row.amount,
  provider: row.provider as PaymentProviderKey,
  saleorSourceObjectType: row.saleorSourceObjectType as PaymentSessionSourceObjectType,
  saleorStatus: row.saleorStatus as SaleorPaymentStatus,
  finalizationState: row.finalizationState as FinalizationState,
  complianceContract: (row.complianceContract as ComplianceContract | null) ?? null,
});

const mapAppSettings = (row: typeof appSettings.$inferSelect) => ({
  ...row,
  defaultProvider: row.defaultProvider as PaymentProviderKey,
  countryRestrictions: normalizePaymentCountryRestrictions(row.countryRestrictions),
});

export const getOrCreateDefaultSettings = async (
  saleorApiUrl: string,
  defaults: PaymentAppSettingsInput
) => {
  const existing = await db.query.appSettings.findFirst({
    where: eq(appSettings.saleorApiUrl, saleorApiUrl),
  });

  if (existing) {
    return mapAppSettings(existing);
  }

  const normalizedDefaults = {
    ...defaults,
    countryRestrictions: normalizePaymentCountryRestrictions(defaults.countryRestrictions),
  };

  const [created] = await db
    .insert(appSettings)
    .values({
      saleorApiUrl,
      defaultProvider: normalizedDefaults.defaultProvider,
      nowpaymentsEnabled: normalizedDefaults.nowpaymentsEnabled,
      moonpayEnabled: normalizedDefaults.moonpayEnabled,
      rampnetworkEnabled: normalizedDefaults.rampnetworkEnabled,
      countryRestrictions: normalizedDefaults.countryRestrictions,
    })
    .returning();

  return mapAppSettings(created);
};

export const updateSettings = async (
  saleorApiUrl: string,
  input: PaymentAppSettingsInput
) => {
  const normalizedInput = {
    ...input,
    countryRestrictions: normalizePaymentCountryRestrictions(input.countryRestrictions),
  };

  const [updated] = await db
    .insert(appSettings)
    .values({
      saleorApiUrl,
      ...normalizedInput,
    })
    .onConflictDoUpdate({
      target: appSettings.saleorApiUrl,
      set: {
        defaultProvider: normalizedInput.defaultProvider,
        nowpaymentsEnabled: normalizedInput.nowpaymentsEnabled,
        moonpayEnabled: normalizedInput.moonpayEnabled,
        rampnetworkEnabled: normalizedInput.rampnetworkEnabled,
        countryRestrictions: normalizedInput.countryRestrictions,
        updatedAt: new Date(),
      },
    })
    .returning();

  return mapAppSettings(updated);
};

export const getPaymentSessionByTransactionId = async (
  saleorApiUrl: string,
  saleorTransactionId: string
) => {
  const row = await db.query.paymentSessions.findFirst({
    where: and(
      eq(paymentSessions.saleorApiUrl, saleorApiUrl),
      eq(paymentSessions.saleorTransactionId, saleorTransactionId)
    ),
  });

  return row ? mapPaymentSession(row) : null;
};

export const getPaymentSessionByProviderReference = async (
  provider: PaymentProviderKey,
  providerReferenceId: string
) => {
  const row = await db.query.paymentSessions.findFirst({
    where: and(
      eq(paymentSessions.provider, provider),
      eq(paymentSessions.providerReferenceId, providerReferenceId)
    ),
    orderBy: desc(paymentSessions.updatedAt),
  });

  return row ? mapPaymentSession(row) : null;
};

export const findPaymentSessionForProviderWebhook = async (input: {
  provider: PaymentProviderKey;
  saleorTransactionId?: string | null;
  providerPaymentId?: string | null;
  providerInvoiceId?: string | null;
  providerReferenceId?: string | null;
}) => {
  const predicates = [
    input.saleorTransactionId ? eq(paymentSessions.saleorTransactionId, input.saleorTransactionId) : null,
    input.providerPaymentId ? eq(paymentSessions.providerPaymentId, input.providerPaymentId) : null,
    input.providerInvoiceId ? eq(paymentSessions.providerInvoiceId, input.providerInvoiceId) : null,
    input.providerReferenceId ? eq(paymentSessions.providerReferenceId, input.providerReferenceId) : null,
  ].filter((predicate): predicate is NonNullable<typeof predicate> => Boolean(predicate));

  if (predicates.length === 0) {
    return null;
  }

  const row = await db.query.paymentSessions.findFirst({
    where: and(eq(paymentSessions.provider, input.provider), or(...predicates)),
    orderBy: desc(paymentSessions.updatedAt),
  });

  return row ? mapPaymentSession(row) : null;
};

export const upsertPaymentSession = async (input: UpsertPaymentSessionInput) => {
  try {
    const [row] = await db
      .insert(paymentSessions)
      .values({
        ...input,
        amount: input.amount.toFixed(6),
      })
      .onConflictDoUpdate({
        target: [paymentSessions.saleorApiUrl, paymentSessions.saleorTransactionId],
        set: {
          saleorTransactionToken: input.saleorTransactionToken,
          saleorPspReference: input.saleorPspReference,
          provider: input.provider,
          providerPaymentId: input.providerPaymentId,
          providerInvoiceId: input.providerInvoiceId,
          providerReferenceId: input.providerReferenceId,
          providerStatus: input.providerStatus,
          saleorStatus: input.saleorStatus,
          amount: input.amount.toFixed(6),
          currency: input.currency,
          hostedUrl: input.hostedUrl,
          redirectUrl: input.redirectUrl,
          lastWebhookPayload: input.lastWebhookPayload,
          complianceContract: input.complianceContract,
          safeErrorSummary: input.safeErrorSummary,
          statusReason: input.statusReason,
          finalizationState: input.finalizationState,
          processedAt: input.processedAt,
          updatedAt: new Date(),
        },
      })
      .returning();

    return mapPaymentSession(row);
  } catch (error) {
    logger.error("Failed to upsert payment session", {
      error: error instanceof Error ? error.message : String(error),
      saleorTransactionId: input.saleorTransactionId,
      provider: input.provider,
    });
    throw new PersistenceError("Failed to upsert payment session.", {
      saleorTransactionId: input.saleorTransactionId,
    });
  }
};

export const appendPaymentSessionEvent = async (input: AppendPaymentSessionEventInput) => {
  try {
    const [row] = await db
      .insert(paymentSessionEvents)
      .values(input)
      .onConflictDoNothing({
        target: paymentSessionEvents.dedupeKey,
      })
      .returning();

    return row ?? null;
  } catch (error) {
    logger.error("Failed to append payment session event", {
      error: error instanceof Error ? error.message : String(error),
      paymentSessionId: input.paymentSessionId,
      dedupeKey: input.dedupeKey,
    });
    throw new PersistenceError("Failed to append payment session event.", {
      paymentSessionId: input.paymentSessionId,
    });
  }
};

export const getSessionTimeline = async (paymentSessionId: string) => {
  return db.query.paymentSessionEvents.findMany({
    where: eq(paymentSessionEvents.paymentSessionId, paymentSessionId),
    orderBy: desc(paymentSessionEvents.createdAt),
  });
};

export const countSearchPaymentSessions = async (saleorApiUrl: string, search: string) => {
  const query = `%${search.trim()}%`;
  const [countRow] = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(paymentSessions)
    .where(
      and(
        eq(paymentSessions.saleorApiUrl, saleorApiUrl),
        or(
          ilike(paymentSessions.saleorTransactionId, query),
          ilike(paymentSessions.providerReferenceId, query),
          ilike(paymentSessions.providerPaymentId, query),
          ilike(paymentSessions.providerInvoiceId, query),
          ilike(paymentSessions.saleorMerchantReference, query)
        )
      )
    );

  return Number(countRow?.count ?? 0);
};

export const searchPaymentSessions = async (
  saleorApiUrl: string,
  search: string,
  input?: {
    limit?: number;
    offset?: number;
  }
) => {
  const query = `%${search.trim()}%`;

  const rows = await db.query.paymentSessions.findMany({
    where: and(
      eq(paymentSessions.saleorApiUrl, saleorApiUrl),
      or(
        ilike(paymentSessions.saleorTransactionId, query),
        ilike(paymentSessions.providerReferenceId, query),
        ilike(paymentSessions.providerPaymentId, query),
        ilike(paymentSessions.providerInvoiceId, query),
        ilike(paymentSessions.saleorMerchantReference, query)
      )
    ),
    orderBy: desc(paymentSessions.updatedAt),
    limit: input?.limit ?? 20,
    offset: input?.offset ?? 0,
  });

  return rows.map(mapPaymentSession);
};

export const countPaymentSessions = async (saleorApiUrl: string) => {
  const [countRow] = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(paymentSessions)
    .where(eq(paymentSessions.saleorApiUrl, saleorApiUrl));

  return Number(countRow?.count ?? 0);
};

export const getRecentPaymentSessions = async (saleorApiUrl: string, limit = 10, offset = 0) => {
  const rows = await db.query.paymentSessions.findMany({
    where: eq(paymentSessions.saleorApiUrl, saleorApiUrl),
    orderBy: desc(paymentSessions.updatedAt),
    limit,
    offset,
  });

  return rows.map(mapPaymentSession);
};

export const getPaymentRecapStats = async (
  saleorApiUrl: string,
  input: {
    from: Date;
    to: Date;
  }
) => {
  const sessionRangePredicate = and(
    eq(paymentSessions.saleorApiUrl, saleorApiUrl),
    gte(paymentSessions.createdAt, input.from),
    lte(paymentSessions.createdAt, input.to)
  );
  const webhookRangePredicate = and(
    eq(paymentSessionEvents.saleorApiUrl, saleorApiUrl),
    eq(paymentSessionEvents.source, "provider"),
    gte(paymentSessionEvents.createdAt, input.from),
    lte(paymentSessionEvents.createdAt, input.to)
  );

  const [sessionCountsRow] = await db
    .select({
      totalCount: sql<number>`count(*)`,
      successCount:
        sql<number>`coalesce(sum(case when ${paymentSessions.saleorStatus} in ('SUCCESS', 'AUTHORIZED') then 1 else 0 end), 0)`,
      failedCount:
        sql<number>`coalesce(sum(case when ${paymentSessions.saleorStatus} in ('FAILED', 'CANCELLED', 'EXPIRED') then 1 else 0 end), 0)`,
      pendingCount:
        sql<number>`coalesce(sum(case when ${paymentSessions.finalizationState} = 'pending' then 1 else 0 end), 0)`,
    })
    .from(paymentSessions)
    .where(sessionRangePredicate);

  const amountRows = await db
    .select({
      currency: paymentSessions.currency,
      successAmount:
        sql<string>`coalesce(sum(case when ${paymentSessions.saleorStatus} in ('SUCCESS', 'AUTHORIZED') then ${paymentSessions.amount} else 0 end), 0)`,
      failedAmount:
        sql<string>`coalesce(sum(case when ${paymentSessions.saleorStatus} in ('FAILED', 'CANCELLED', 'EXPIRED') then ${paymentSessions.amount} else 0 end), 0)`,
      pendingAmount:
        sql<string>`coalesce(sum(case when ${paymentSessions.finalizationState} = 'pending' then ${paymentSessions.amount} else 0 end), 0)`,
    })
    .from(paymentSessions)
    .where(sessionRangePredicate)
    .groupBy(paymentSessions.currency)
    .orderBy(asc(paymentSessions.currency));

  const [webhookCountRow] = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(paymentSessionEvents)
    .where(webhookRangePredicate);

  const latestWebhook = await db.query.paymentSessionEvents.findFirst({
    where: webhookRangePredicate,
    orderBy: desc(paymentSessionEvents.createdAt),
  });

  const latestErrorSession = await db.query.paymentSessions.findFirst({
    where: and(
      eq(paymentSessions.saleorApiUrl, saleorApiUrl),
      gte(paymentSessions.updatedAt, input.from),
      lte(paymentSessions.updatedAt, input.to),
      sql`${paymentSessions.safeErrorSummary} is not null`
    ),
    orderBy: desc(paymentSessions.updatedAt),
  });

  return {
    rangeStart: input.from,
    rangeEnd: input.to,
    transactionCount: Number(sessionCountsRow?.totalCount ?? 0),
    successCount: Number(sessionCountsRow?.successCount ?? 0),
    failedCount: Number(sessionCountsRow?.failedCount ?? 0),
    pendingCount: Number(sessionCountsRow?.pendingCount ?? 0),
    amountsByCurrency: amountRows.map((row) => ({
      currency: row.currency,
      successAmount: Number(row.successAmount ?? 0),
      failedAmount: Number(row.failedAmount ?? 0),
      pendingAmount: Number(row.pendingAmount ?? 0),
    })),
    webhookCount: Number(webhookCountRow?.count ?? 0),
    latestWebhook,
    latestErrorSession,
  };
};

export const getOverviewStats = async (saleorApiUrl: string) => {
  const [transactionCountRow] = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(paymentSessions)
    .where(eq(paymentSessions.saleorApiUrl, saleorApiUrl));

  const [webhookCountRow] = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(paymentSessionEvents)
    .where(
      and(
        eq(paymentSessionEvents.saleorApiUrl, saleorApiUrl),
        eq(paymentSessionEvents.source, "provider")
      )
    );

  const latestWebhook = await db.query.paymentSessionEvents.findFirst({
    where: and(
      eq(paymentSessionEvents.saleorApiUrl, saleorApiUrl),
      eq(paymentSessionEvents.source, "provider")
    ),
    orderBy: desc(paymentSessionEvents.createdAt),
  });

  const latestErrorSession = await db.query.paymentSessions.findFirst({
    where: and(
      eq(paymentSessions.saleorApiUrl, saleorApiUrl),
      sql`${paymentSessions.safeErrorSummary} is not null`
    ),
    orderBy: desc(paymentSessions.updatedAt),
  });

  return {
    transactionCount: Number(transactionCountRow?.count ?? 0),
    webhookCount: Number(webhookCountRow?.count ?? 0),
    latestWebhook,
    latestErrorSession,
  };
};
