import { AuthData } from "@saleor/app-sdk/APL";

import { getEnv } from "@/modules/config/env";
import { ValidationError } from "@/modules/core/errors";
import { checkDatabaseConnection } from "@/modules/db/client";
import {
  getOrCreateDefaultSettings,
  getOverviewStats,
  getPaymentSessionByTransactionId,
  getRecentPaymentSessions,
  getSessionTimeline,
  searchPaymentSessions,
  updateSettings,
} from "@/modules/db/repository";
import { getAvailableProviders } from "@/modules/payments/providers";
import { manuallyReconcilePaymentSession } from "@/modules/payments/service";
import { PaymentProviderKey } from "@/modules/payments/types";
import { maskSecret } from "@/modules/utils/redact";

const getSettings = async (saleorApiUrl: string) =>
  getOrCreateDefaultSettings(saleorApiUrl, {
    defaultProvider: getEnv().defaultPaymentProvider,
    nowpaymentsEnabled: getEnv().enableNowPayments,
    moonpayEnabled: getEnv().enableMoonPay,
    rampnetworkEnabled: getEnv().enableRampNetwork,
  });

export const getDashboardOverview = async (authData: AuthData) => {
  const env = getEnv();
  const [settings, stats, database, providers, transactions] = await Promise.all([
    getSettings(authData.saleorApiUrl),
    getOverviewStats(authData.saleorApiUrl),
    checkDatabaseConnection(),
    Promise.resolve(getAvailableProviders().map((provider) => provider.getDashboardStatus())),
    getRecentPaymentSessions(authData.saleorApiUrl, 10),
  ]);

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

export const saveDashboardSettings = async (
  authData: AuthData,
  input: {
    defaultProvider: PaymentProviderKey;
    nowpaymentsEnabled: boolean;
    moonpayEnabled: boolean;
    rampnetworkEnabled: boolean;
  }
) => {
  if (!input.nowpaymentsEnabled && !input.moonpayEnabled && !input.rampnetworkEnabled) {
    throw new ValidationError(
      "At least one payment provider must remain enabled.",
      "Enable at least one provider before saving settings."
    );
  }

  if (input.defaultProvider === "nowpayments" && !input.nowpaymentsEnabled) {
    throw new ValidationError(
      "NOWPayments cannot be the fallback provider when it is disabled.",
      "Choose an enabled fallback provider."
    );
  }

  if (input.defaultProvider === "moonpay" && !input.moonpayEnabled) {
    throw new ValidationError(
      "MoonPay cannot be the fallback provider when it is disabled.",
      "Choose an enabled fallback provider."
    );
  }

  if (input.defaultProvider === "rampnetwork" && !input.rampnetworkEnabled) {
    throw new ValidationError(
      "Ramp Network cannot be the fallback provider when it is disabled.",
      "Choose an enabled fallback provider."
    );
  }

  return updateSettings(authData.saleorApiUrl, input);
};

export const lookupTransactions = async (authData: AuthData, search?: string) => {
  const sessions = search?.trim()
    ? await searchPaymentSessions(authData.saleorApiUrl, search)
    : await getRecentPaymentSessions(authData.saleorApiUrl, 20);

  return Promise.all(
    sessions.map(async (session) => ({
      session,
      timeline: await getSessionTimeline(session.id),
    }))
  );
};

export const reconcileTransactionById = async (authData: AuthData, saleorTransactionId: string) => {
  const session = await getPaymentSessionByTransactionId(authData.saleorApiUrl, saleorTransactionId);

  if (!session) {
    throw new ValidationError(
      `Transaction ${saleorTransactionId} was not found.`,
      "We could not find that transaction."
    );
  }

  return manuallyReconcilePaymentSession(session);
};
