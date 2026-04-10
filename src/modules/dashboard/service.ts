import { AuthData } from "@saleor/app-sdk/APL";

import { getEnv } from "@/modules/config/env";
import { ValidationError } from "@/modules/core/errors";
import { checkDatabaseConnection } from "@/modules/db/client";
import {
  countPaymentSessions,
  countSearchPaymentSessions,
  getOrCreateDefaultSettings,
  getOverviewStats,
  getPaymentRecapStats,
  getPaymentSessionByTransactionId,
  getRecentPaymentSessions,
  getSessionTimeline,
  searchPaymentSessions,
  updateSettings,
} from "@/modules/db/repository";
import {
  defaultPaymentCountryRestrictions,
  normalizePaymentCountryRestrictions,
} from "@/modules/payments/country-restrictions";
import { getAvailableProviders } from "@/modules/payments/providers";
import { manuallyReconcilePaymentSession } from "@/modules/payments/service";
import { PaymentAppSettingsInput } from "@/modules/payments/types";
import { maskSecret } from "@/modules/utils/redact";

const getSettings = async (saleorApiUrl: string) =>
  getOrCreateDefaultSettings(saleorApiUrl, {
    defaultProvider: getEnv().defaultPaymentProvider,
    nowpaymentsEnabled: getEnv().enableNowPayments,
    moonpayEnabled: getEnv().enableMoonPay,
    rampnetworkEnabled: getEnv().enableRampNetwork,
    countryRestrictions: defaultPaymentCountryRestrictions,
  });

export const dashboardRecapRanges = ["today", "7d", "month", "custom"] as const;

export type DashboardRecapRange = (typeof dashboardRecapRanges)[number];

export const defaultDashboardRecapRange: DashboardRecapRange = "7d";
export const transactionsPageSize = 20;

const normalizeDashboardRecapRange = (value?: string | null): DashboardRecapRange => {
  if (value === "24h" || value === "today") {
    return "today";
  }

  if (value === "30d" || value === "month") {
    return "month";
  }

  if (value === "7d") {
    return "7d";
  }

  if (value === "custom") {
    return "custom";
  }

  return defaultDashboardRecapRange;
};

const startOfDay = (value: Date) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0));

const endOfDay = (value: Date) =>
  new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 23, 59, 59, 999),
  );

const startOfMonth = (value: Date) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1, 0, 0, 0, 0));

const parseDateInput = (value?: string | null) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const resolvePresetRecapRange = (range: DashboardRecapRange, now: Date) => {
  if (range === "today") {
    return {
      range: "today" as const,
      from: startOfDay(now),
      to: now,
    };
  }

  if (range === "month") {
    return {
      range: "month" as const,
      from: startOfMonth(now),
      to: now,
    };
  }

  const from = startOfDay(now);
  from.setUTCDate(from.getUTCDate() - 6);

  return {
    range: "7d" as const,
    from,
    to: now,
  };
};

const resolveDashboardRecapWindow = (input?: {
  range?: string | null;
  from?: string | null;
  to?: string | null;
}) => {
  const now = new Date();
  const parsedFrom = parseDateInput(input?.from);
  const parsedTo = parseDateInput(input?.to);

  if (parsedFrom && parsedTo && parsedFrom.getTime() <= parsedTo.getTime()) {
    const customFrom = startOfDay(parsedFrom);
    const customTo = endOfDay(parsedTo);

    return {
      range: "custom" as const,
      from: customFrom,
      to: customTo > now ? now : customTo,
    };
  }

  return resolvePresetRecapRange(normalizeDashboardRecapRange(input?.range), now);
};

export const getDashboardOverview = async (
  authData: AuthData,
  input?: {
    range?: string | null;
    from?: string | null;
    to?: string | null;
  },
) => {
  const env = getEnv();
  const recapWindow = resolveDashboardRecapWindow(input);
  const [settings, stats, paymentRecapStats, database, providers, transactions] = await Promise.all(
    [
      getSettings(authData.saleorApiUrl),
      getOverviewStats(authData.saleorApiUrl),
      getPaymentRecapStats(authData.saleorApiUrl, {
        from: recapWindow.from,
        to: recapWindow.to,
      }),
      checkDatabaseConnection(),
      Promise.resolve(getAvailableProviders().map((provider) => provider.getDashboardStatus())),
      getRecentPaymentSessions(authData.saleorApiUrl, 10),
    ],
  );
  const resolvedTransactionCount = paymentRecapStats.successCount + paymentRecapStats.failedCount;
  const successRate =
    resolvedTransactionCount > 0
      ? Math.round((paymentRecapStats.successCount / resolvedTransactionCount) * 1000) / 10
      : null;

  const warnings: string[] = [];

  if (!database.ok) {
    warnings.push(`Database connectivity issue: ${database.error}`);
  }

  if (!providers.some((provider) => provider.enabled && provider.isConfigured)) {
    warnings.push("No payment provider is both enabled and fully configured.");
  }

  return {
    connection: {
      installed: true,
      saleorApiUrl: authData.saleorApiUrl,
      appId: authData.appId,
      environment: env.nodeEnv,
    },
    settings,
    providers,
    stats: {
      recentTransactionCount: stats.transactionCount,
      recentWebhookCount: stats.webhookCount,
      latestWebhook: stats.latestWebhook,
      lastSafeErrorSummary: stats.latestErrorSession?.safeErrorSummary ?? null,
    },
    paymentRecap: {
      range: recapWindow.range,
      from: recapWindow.from.toISOString(),
      to: recapWindow.to.toISOString(),
      transactionCount: paymentRecapStats.transactionCount,
      successCount: paymentRecapStats.successCount,
      failedCount: paymentRecapStats.failedCount,
      pendingCount: paymentRecapStats.pendingCount,
      resolvedTransactionCount,
      amountsByCurrency: paymentRecapStats.amountsByCurrency,
      webhookCount: paymentRecapStats.webhookCount,
      successRate,
      latestWebhook: paymentRecapStats.latestWebhook,
      lastSafeErrorSummary: paymentRecapStats.latestErrorSession?.safeErrorSummary ?? null,
    },
    warnings,
    recentTransactions: transactions,
    secrets: {
      nowpaymentsApiKey: maskSecret(env.nowpayments.apiKey),
      moonpayPublishableKey: maskSecret(env.moonpay.publishableKey),
      moonpaySecretKey: env.moonpay.secretKey ? "configured" : "missing",
      moonpayWebhookKey: env.moonpay.webhookKey ? "configured" : "missing",
      rampnetworkApiKey: maskSecret(env.rampnetwork.apiKey),
      rampnetworkWebhookSecret: env.rampnetwork.webhookSecret ? "configured" : "missing",
      complianceSharedSecret: env.complianceAppSharedSecret ? "configured" : "missing",
    },
  };
};

export const getDiagnostics = async (authData: AuthData) => {
  const env = getEnv();
  const database = await checkDatabaseConnection();
  const settings = await getSettings(authData.saleorApiUrl);
  const stats = await getOverviewStats(authData.saleorApiUrl);
  const providers = getAvailableProviders().map((provider) => provider.getDashboardStatus());

  return {
    database,
    apl: {
      configured: true,
      saleorApiUrl: authData.saleorApiUrl,
      appId: authData.appId,
    },
    providerConfig: providers,
    settings,
    latestWebhook: stats.latestWebhook,
    lastSafeErrorSummary: stats.latestErrorSession?.safeErrorSummary ?? null,
  };
};

export const saveDashboardSettings = async (authData: AuthData, input: PaymentAppSettingsInput) => {
  const countryRestrictions = normalizePaymentCountryRestrictions(input.countryRestrictions);

  if (countryRestrictions.mode !== "allow_all" && countryRestrictions.countries.length === 0) {
    throw new ValidationError(
      "Country-based payment rules require at least one ISO country code.",
      "Add at least one country code before saving the payment country rule.",
    );
  }

  const hasEnabledProvider =
    input.nowpaymentsEnabled || input.moonpayEnabled || input.rampnetworkEnabled;

  if (hasEnabledProvider && input.defaultProvider === "nowpayments" && !input.nowpaymentsEnabled) {
    throw new ValidationError(
      "NOWPayments cannot be the fallback provider when it is disabled.",
      "Choose an enabled fallback provider.",
    );
  }

  if (hasEnabledProvider && input.defaultProvider === "moonpay" && !input.moonpayEnabled) {
    throw new ValidationError(
      "MoonPay cannot be the fallback provider when it is disabled.",
      "Choose an enabled fallback provider.",
    );
  }

  if (hasEnabledProvider && input.defaultProvider === "rampnetwork" && !input.rampnetworkEnabled) {
    throw new ValidationError(
      "Ramp Network cannot be the fallback provider when it is disabled.",
      "Choose an enabled fallback provider.",
    );
  }

  return updateSettings(authData.saleorApiUrl, {
    ...input,
    countryRestrictions,
  });
};

export const lookupTransactions = async (
  authData: AuthData,
  input?: {
    search?: string;
    page?: number;
    pageSize?: number;
  },
) => {
  const pageSize = input?.pageSize && input.pageSize > 0 ? input.pageSize : transactionsPageSize;
  const page = input?.page && input.page > 0 ? Math.floor(input.page) : 1;
  const offset = (page - 1) * pageSize;
  const normalizedSearch = input?.search?.trim();

  const [sessions, totalCount] = normalizedSearch
    ? await Promise.all([
        searchPaymentSessions(authData.saleorApiUrl, normalizedSearch, {
          limit: pageSize,
          offset,
        }),
        countSearchPaymentSessions(authData.saleorApiUrl, normalizedSearch),
      ])
    : await Promise.all([
        getRecentPaymentSessions(authData.saleorApiUrl, pageSize, offset),
        countPaymentSessions(authData.saleorApiUrl),
      ]);

  const items = await Promise.all(
    sessions.map(async (session) => ({
      session,
      timeline: await getSessionTimeline(session.id),
    })),
  );

  return {
    items,
    page,
    pageSize,
    totalCount,
    hasPreviousPage: page > 1,
    hasNextPage: page * pageSize < totalCount,
  };
};

export const reconcileTransactionById = async (authData: AuthData, saleorTransactionId: string) => {
  const session = await getPaymentSessionByTransactionId(
    authData.saleorApiUrl,
    saleorTransactionId,
  );

  if (!session) {
    throw new ValidationError(
      `Transaction ${saleorTransactionId} was not found.`,
      "We could not find that transaction.",
    );
  }

  return manuallyReconcilePaymentSession(session);
};
