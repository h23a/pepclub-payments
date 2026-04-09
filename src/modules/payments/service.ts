import { AuthData } from "@saleor/app-sdk/APL";
import { buildSyncWebhookResponsePayload } from "@saleor/app-sdk/handlers/shared";
import crypto from "crypto";

import {
  assertCompliancePreconditions,
  resolveComplianceContract,
} from "@/modules/compliance/validation";
import { getEnv } from "@/modules/config/env";
import {
  AppError,
  ProviderConfigError,
  ReconciliationError,
  ValidationError,
} from "@/modules/core/errors";
import { logger } from "@/modules/core/logger";
import {
  appendPaymentSessionEvent,
  findPaymentSessionForProviderWebhook,
  getOrCreateDefaultSettings,
  getPaymentSessionByTransactionId,
  upsertPaymentSession,
} from "@/modules/db/repository";
import { createUsdQuoteFromThbAmount } from "@/modules/fx/service";
import { reportTransactionEvent } from "@/modules/saleor/client";
import {
  getPaymentGatewayData,
  getSaleorActionType,
  getSourceObjectIdentifiers,
  SaleorTransactionSessionPayload,
} from "@/modules/saleor/types";

import {
  defaultPaymentCountryRestrictions,
  isCountryAllowedByRestrictions,
  resolveSourceObjectCountryCode,
} from "./country-restrictions";
import { resolveProviderKey } from "./provider-resolver";
import { getProvider } from "./providers";
import { mapSaleorStatusToSyncResult } from "./status-mapping";
import {
  PaymentGatewayData,
  PaymentProviderKey,
  PaymentSessionRecord,
  ProviderStatusResult,
  UsdQuoteMetadata,
} from "./types";

const makeSessionId = () => crypto.randomUUID();
const makeEventId = () => crypto.randomUUID();
const hostedProviderKeys = new Set<PaymentProviderKey>(["nowpayments", "moonpay", "rampnetwork"]);

type SyncWebhookError = {
  code: string;
  message: string;
  field?: string;
};

const safeErrorSummary = (error: unknown) => {
  if (error instanceof AppError) {
    return error.safeMessage;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown payment error";
};

const safeErrorCode = (error: unknown) => {
  if (error instanceof AppError) {
    return error.code;
  }

  return "PAYMENT_ERROR";
};

const safeErrorField = (error: unknown) => {
  if (!(error instanceof AppError)) {
    return undefined;
  }

  const field = error.details?.field;
  return typeof field === "string" ? field : undefined;
};

const buildFailureSyncResponseData = (error: unknown) => {
  const syncError: SyncWebhookError = {
    code: safeErrorCode(error),
    message: safeErrorSummary(error),
  };
  const field = safeErrorField(error);

  if (field) {
    syncError.field = field;
  }

  return {
    errors: [syncError],
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const resolveHostedUsdQuote = async (input: {
  amount: number;
  currency: string;
  providerKey: PaymentProviderKey;
}) => {
  if (!hostedProviderKeys.has(input.providerKey)) {
    return null;
  }

  const env = getEnv();
  const normalizedCurrency = input.currency.toUpperCase();

  if (normalizedCurrency === env.fx.targetCurrency) {
    return {
      displayAmountUsd: Number(input.amount.toFixed(2)),
      displayCurrency: env.fx.targetCurrency,
      fxProvider: "saleor",
      fxRate: 1,
      fxTimestamp: new Date().toISOString(),
      providerAmount: Number(input.amount.toFixed(2)),
      providerCurrency: env.fx.targetCurrency,
      sourceAmount: Number(input.amount.toFixed(2)),
      sourceCurrency: normalizedCurrency,
    } satisfies UsdQuoteMetadata;
  }

  if (normalizedCurrency !== env.fx.sourceCurrency) {
    return null;
  }

  try {
    return await createUsdQuoteFromThbAmount(input.amount);
  } catch {
    throw new ValidationError(
      `USD quote is unavailable for ${input.providerKey}.`,
      "We couldn't retrieve the latest USD exchange rate. Please try again."
    );
  }
};

const buildProviderAuditPayload = (input: {
  existingPayload?: unknown;
  providerResult: ProviderStatusResult;
  requestedGatewayData?: PaymentGatewayData;
}) => {
  const nextPayload = isRecord(input.existingPayload) ? { ...input.existingPayload } : {};

  if (input.providerResult.rawResponse !== undefined) {
    nextPayload.providerResponse = input.providerResult.rawResponse;
  } else if (input.existingPayload !== undefined && !isRecord(input.existingPayload)) {
    nextPayload.providerResponse = input.existingPayload;
  }

  if (input.providerResult.providerAmount !== undefined && input.providerResult.providerAmount !== null) {
    nextPayload.providerAmount = input.providerResult.providerAmount;
  }

  if (input.providerResult.providerCurrency) {
    nextPayload.providerCurrency = input.providerResult.providerCurrency;
  }

  if (input.providerResult.fxQuote) {
    nextPayload.fxQuote = input.providerResult.fxQuote;
  }

  if (input.requestedGatewayData && Object.keys(input.requestedGatewayData).length > 0) {
    nextPayload.requestedGatewayData = input.requestedGatewayData;
  }

  return Object.keys(nextPayload).length > 0
    ? nextPayload
    : input.providerResult.rawResponse ?? input.existingPayload;
};

const buildProviderEventPayload = (
  providerResult: ProviderStatusResult,
  requestedGatewayData?: PaymentGatewayData
) =>
  buildProviderAuditPayload({
    providerResult,
    requestedGatewayData,
  });

const buildSyncResponseData = (providerKey: PaymentProviderKey, providerResult: ProviderStatusResult) => {
  const payload: Record<string, unknown> = {
    provider: providerKey,
    providerStatus: providerResult.providerStatus,
    redirectUrl: providerResult.redirectUrl,
    hostedUrl: providerResult.hostedUrl,
  };

  if (providerResult.providerCurrency) {
    payload.providerCurrency = providerResult.providerCurrency;
  }

  if (providerResult.providerAmount !== undefined && providerResult.providerAmount !== null) {
    payload.providerAmount = providerResult.providerAmount;
  }

  if (providerResult.fxQuote) {
    payload.fxQuote = providerResult.fxQuote;
  }

  return payload;
};

const createSyncWebhookResponse = (input: {
  saleorStatus: ProviderStatusResult["saleorStatus"];
  amount: number;
  actionType: "CHARGE" | "AUTHORIZATION";
  providerReference?: string | null;
  externalUrl?: string | null;
  message?: string | null;
  data?: Record<string, unknown>;
}) =>
  buildSyncWebhookResponsePayload({
    result: mapSaleorStatusToSyncResult(input.saleorStatus, input.actionType),
    amount: input.amount,
    pspReference: input.providerReference ?? undefined,
    externalUrl: input.externalUrl ?? undefined,
    message: input.message ?? undefined,
    data: input.data ?? undefined,
    actions: [],
  });

const resolveSettingsForTenant = async (saleorApiUrl: string) =>
  getOrCreateDefaultSettings(saleorApiUrl, {
    defaultProvider: getEnv().defaultPaymentProvider,
    nowpaymentsEnabled: getEnv().enableNowPayments,
    moonpayEnabled: getEnv().enableMoonPay,
    rampnetworkEnabled: getEnv().enableRampNetwork,
    countryRestrictions: defaultPaymentCountryRestrictions,
  });

export const initializePaymentSession = async (input: {
  payload: SaleorTransactionSessionPayload;
  authData: AuthData;
  baseUrl: string;
}) => {
  const gatewayData = getPaymentGatewayData(input.payload);
  const settings = await resolveSettingsForTenant(input.authData.saleorApiUrl);
  const countryCode = resolveSourceObjectCountryCode(
    input.payload.sourceObject,
    settings.countryRestrictions.addressSource
  );

  if (!countryCode) {
    throw new ValidationError(
      "Payment initialization requires a shipping country code.",
      "A shipping address is required before payment can start.",
      {
        field: "shippingAddress",
        saleorApiUrl: input.authData.saleorApiUrl,
        sourceObjectId: input.payload.sourceObject.id,
        sourceObjectType: input.payload.sourceObject.__typename,
      }
    );
  }

  if (!isCountryAllowedByRestrictions(settings.countryRestrictions, countryCode)) {
    const restrictionSummary =
      settings.countryRestrictions.mode === "allow_list"
        ? `Payments are currently available only for shipping addresses in: ${settings.countryRestrictions.countries.join(", ")}.`
        : "This shipping address is not eligible for payment under the current country restrictions.";

    throw new ValidationError(
      `Payment initialization blocked for country ${countryCode}.`,
      restrictionSummary,
      {
        configuredCountries: settings.countryRestrictions.countries,
        countryCode,
        field: "shippingAddress.country",
        restrictionMode: settings.countryRestrictions.mode,
        saleorApiUrl: input.authData.saleorApiUrl,
      }
    );
  }

  const providerKey = resolveProviderKey(gatewayData, settings);
  const provider = getProvider(providerKey);
  const validation = provider.validateConfig();

  if (!validation.isConfigured) {
    throw new ProviderConfigError(`${providerKey} is enabled but not configured.`, validation);
  }

  const complianceContract = assertCompliancePreconditions(
    await resolveComplianceContract({
      gatewayDataContract: gatewayData.compliance,
      saleorApiUrl: input.authData.saleorApiUrl,
      sourceObject: input.payload.sourceObject,
      merchantReference: input.payload.merchantReference,
    })
  );
  const sourceIdentifiers = getSourceObjectIdentifiers(input.payload.sourceObject);
  const actionType = getSaleorActionType(input.payload.action.actionType);
  const existingSession = await getPaymentSessionByTransactionId(
    input.authData.saleorApiUrl,
    input.payload.transaction.id
  );
  const usdQuote = existingSession
    ? null
    : await resolveHostedUsdQuote({
        amount: input.payload.action.amount,
        currency: input.payload.action.currency,
        providerKey,
      });

  const providerResult = existingSession
    ? await provider.processSession(existingSession)
    : await provider.initializeSession({
        saleorApiUrl: input.authData.saleorApiUrl,
        amount: input.payload.action.amount,
        currency: input.payload.action.currency,
        merchantReference: input.payload.merchantReference,
        transactionId: input.payload.transaction.id,
        idempotencyKey: input.payload.idempotencyKey ?? input.payload.transaction.id,
        customerIpAddress: input.payload.customerIpAddress,
        customerEmail: sourceIdentifiers.customerEmail,
        baseUrl: input.baseUrl,
        gatewayData,
        providerAmount: usdQuote?.providerAmount,
        providerCurrency: usdQuote?.providerCurrency,
        fxQuote: usdQuote,
        sourceObjectId: sourceIdentifiers.sourceObjectId,
        sourceObjectType: sourceIdentifiers.sourceObjectType,
      });

  const session = await upsertPaymentSession({
    id: existingSession?.id ?? makeSessionId(),
    saleorApiUrl: input.authData.saleorApiUrl,
    saleorTransactionId: input.payload.transaction.id,
    saleorTransactionToken: input.payload.transaction.token ?? null,
    saleorPspReference: input.payload.transaction.pspReference ?? null,
    saleorMerchantReference: input.payload.merchantReference,
    saleorSourceObjectType: sourceIdentifiers.sourceObjectType,
    saleorSourceObjectId: sourceIdentifiers.sourceObjectId,
    checkoutId: sourceIdentifiers.checkoutId,
    orderId: sourceIdentifiers.orderId,
    customerEmail: sourceIdentifiers.customerEmail,
    channelSlug: sourceIdentifiers.channelSlug,
    provider: providerKey,
    providerPaymentId: providerResult.providerPaymentId,
    providerInvoiceId: providerResult.providerInvoiceId,
    providerReferenceId: providerResult.providerReferenceId,
    providerStatus: providerResult.providerStatus,
    saleorStatus: providerResult.saleorStatus,
    amount: input.payload.action.amount,
    currency: input.payload.action.currency,
    hostedUrl: providerResult.hostedUrl,
    redirectUrl: providerResult.redirectUrl,
    idempotencyKey: input.payload.idempotencyKey ?? input.payload.transaction.id,
    lastWebhookPayload: buildProviderAuditPayload({
      providerResult,
      requestedGatewayData: gatewayData,
    }),
    complianceContract,
    safeErrorSummary: null,
    statusReason: providerResult.message ?? null,
    finalizationState: providerResult.finalizationState,
    processedAt: providerResult.finalizationState === "finalized" ? new Date() : null,
  });

  await appendPaymentSessionEvent({
    id: makeEventId(),
    paymentSessionId: session.id,
    saleorApiUrl: input.authData.saleorApiUrl,
    source: "saleor",
    eventType: "TRANSACTION_INITIALIZE_SESSION",
    dedupeKey: `saleor:init:${input.authData.saleorApiUrl}:${input.payload.transaction.id}:${input.payload.idempotencyKey ?? "none"}`,
    providerStatus: providerResult.providerStatus,
    saleorStatus: providerResult.saleorStatus,
    message: providerResult.message ?? "Session initialized",
    payload: {
      transactionId: input.payload.transaction.id,
      provider: providerKey,
      providerResult: buildProviderEventPayload(providerResult, gatewayData),
    },
  });

  return {
    session,
    response: createSyncWebhookResponse({
      saleorStatus: providerResult.saleorStatus,
      amount: input.payload.action.amount,
      actionType,
      providerReference:
        providerResult.providerReferenceId ??
        providerResult.providerPaymentId ??
        providerResult.providerInvoiceId ??
        input.payload.merchantReference,
      externalUrl: providerResult.redirectUrl ?? providerResult.hostedUrl ?? null,
      message: providerResult.message,
      data: buildSyncResponseData(providerKey, providerResult),
    }),
  };
};

export const processPaymentSession = async (input: {
  payload: SaleorTransactionSessionPayload;
  authData: AuthData;
}) => {
  const existingSession = await getPaymentSessionByTransactionId(
    input.authData.saleorApiUrl,
    input.payload.transaction.id
  );

  if (!existingSession) {
    throw new ValidationError(
      `Transaction ${input.payload.transaction.id} does not have an initialized payment session.`,
      "This payment session has not been initialized yet."
    );
  }

  const provider = getProvider(existingSession.provider);
  const actionType = getSaleorActionType(input.payload.action.actionType);
  const providerResult = await provider.processSession(existingSession);

  const session = await upsertPaymentSession({
    id: existingSession.id,
    saleorApiUrl: existingSession.saleorApiUrl,
    saleorTransactionId: existingSession.saleorTransactionId,
    saleorTransactionToken: input.payload.transaction.token ?? existingSession.saleorTransactionToken,
    saleorPspReference: input.payload.transaction.pspReference ?? existingSession.saleorPspReference,
    saleorMerchantReference: existingSession.saleorMerchantReference,
    saleorSourceObjectType: existingSession.saleorSourceObjectType,
    saleorSourceObjectId: existingSession.saleorSourceObjectId,
    checkoutId: existingSession.checkoutId,
    orderId: existingSession.orderId,
    customerEmail: existingSession.customerEmail,
    channelSlug: existingSession.channelSlug,
    provider: existingSession.provider,
    providerPaymentId: providerResult.providerPaymentId ?? existingSession.providerPaymentId,
    providerInvoiceId: providerResult.providerInvoiceId ?? existingSession.providerInvoiceId,
    providerReferenceId: providerResult.providerReferenceId ?? existingSession.providerReferenceId,
    providerStatus: providerResult.providerStatus,
    saleorStatus: providerResult.saleorStatus,
    amount: Number(existingSession.amount),
    currency: existingSession.currency,
    hostedUrl: providerResult.hostedUrl ?? existingSession.hostedUrl,
    redirectUrl: providerResult.redirectUrl ?? existingSession.redirectUrl,
    idempotencyKey: existingSession.idempotencyKey,
    lastWebhookPayload: buildProviderAuditPayload({
      existingPayload: existingSession.lastWebhookPayload,
      providerResult,
    }),
    complianceContract: existingSession.complianceContract,
    safeErrorSummary: null,
    statusReason: providerResult.message ?? existingSession.statusReason,
    finalizationState: providerResult.finalizationState,
    processedAt: providerResult.finalizationState === "finalized" ? new Date() : existingSession.processedAt,
  });

  await appendPaymentSessionEvent({
    id: makeEventId(),
    paymentSessionId: session.id,
    saleorApiUrl: input.authData.saleorApiUrl,
    source: "saleor",
    eventType: "TRANSACTION_PROCESS_SESSION",
    dedupeKey: `saleor:process:${input.authData.saleorApiUrl}:${session.saleorTransactionId}:${providerResult.providerStatus}`,
    providerStatus: providerResult.providerStatus,
    saleorStatus: providerResult.saleorStatus,
    message: providerResult.message ?? "Session processed",
    payload: buildProviderEventPayload(providerResult),
  });

  return {
    session,
    response: createSyncWebhookResponse({
      saleorStatus: providerResult.saleorStatus,
      amount: input.payload.action.amount,
      actionType,
      providerReference:
        providerResult.providerReferenceId ??
        providerResult.providerPaymentId ??
        providerResult.providerInvoiceId ??
        input.payload.merchantReference,
      externalUrl: providerResult.redirectUrl ?? providerResult.hostedUrl ?? null,
      message: providerResult.message,
      data: buildSyncResponseData(existingSession.provider, providerResult),
    }),
  };
};

export const manuallyReconcilePaymentSession = async (session: PaymentSessionRecord) => {
  const provider = getProvider(session.provider);
  const providerResult = await provider.getStatus(session);

  const updatedSession = await upsertPaymentSession({
    id: session.id,
    saleorApiUrl: session.saleorApiUrl,
    saleorTransactionId: session.saleorTransactionId,
    saleorTransactionToken: session.saleorTransactionToken,
    saleorPspReference: session.saleorPspReference,
    saleorMerchantReference: session.saleorMerchantReference,
    saleorSourceObjectType: session.saleorSourceObjectType,
    saleorSourceObjectId: session.saleorSourceObjectId,
    checkoutId: session.checkoutId,
    orderId: session.orderId,
    customerEmail: session.customerEmail,
    channelSlug: session.channelSlug,
    provider: session.provider,
    providerPaymentId: providerResult.providerPaymentId ?? session.providerPaymentId,
    providerInvoiceId: providerResult.providerInvoiceId ?? session.providerInvoiceId,
    providerReferenceId: providerResult.providerReferenceId ?? session.providerReferenceId,
    providerStatus: providerResult.providerStatus,
    saleorStatus: providerResult.saleorStatus,
    amount: Number(session.amount),
    currency: session.currency,
    hostedUrl: providerResult.hostedUrl ?? session.hostedUrl,
    redirectUrl: providerResult.redirectUrl ?? session.redirectUrl,
    idempotencyKey: session.idempotencyKey,
    lastWebhookPayload: buildProviderAuditPayload({
      existingPayload: session.lastWebhookPayload,
      providerResult,
    }),
    complianceContract: session.complianceContract,
    safeErrorSummary: null,
    statusReason: providerResult.message ?? session.statusReason,
    finalizationState: providerResult.finalizationState,
    processedAt: providerResult.finalizationState === "finalized" ? new Date() : session.processedAt,
  });

  await appendPaymentSessionEvent({
    id: makeEventId(),
    paymentSessionId: session.id,
    saleorApiUrl: session.saleorApiUrl,
    source: "system",
    eventType: "MANUAL_RECONCILE",
    dedupeKey: `manual:reconcile:${session.id}:${providerResult.providerStatus}`,
    providerStatus: providerResult.providerStatus,
    saleorStatus: providerResult.saleorStatus,
    message: providerResult.message ?? "Manual reconcile completed",
    payload: buildProviderEventPayload(providerResult),
  });

  return updatedSession;
};

const extractWebhookLookupData = (providerKey: PaymentProviderKey, rawResponse: unknown) => {
  const record = rawResponse && typeof rawResponse === "object" ? (rawResponse as Record<string, unknown>) : {};

  if (providerKey === "nowpayments") {
    return {
      saleorTransactionId:
        typeof record.order_id === "string"
          ? record.order_id
          : typeof record.purchase_id === "string"
            ? record.purchase_id
            : null,
      providerPaymentId:
        record.payment_id !== undefined && record.payment_id !== null ? String(record.payment_id) : null,
      providerInvoiceId:
        record.invoice_id !== undefined && record.invoice_id !== null ? String(record.invoice_id) : null,
      providerReferenceId:
        record.payment_id !== undefined && record.payment_id !== null ? String(record.payment_id) : null,
    };
  }

  if (providerKey === "rampnetwork") {
    return {
      saleorTransactionId: null,
      providerPaymentId: typeof record.id === "string" ? record.id : null,
      providerInvoiceId: null,
      providerReferenceId:
        typeof record.purchaseViewToken === "string" ? record.purchaseViewToken : null,
    };
  }

  const data =
    record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : record;

  return {
    saleorTransactionId:
      typeof data.externalTransactionId === "string" ? data.externalTransactionId : null,
    providerPaymentId: typeof data.id === "string" ? data.id : null,
    providerInvoiceId: null,
    providerReferenceId:
      typeof data.externalTransactionId === "string"
        ? data.externalTransactionId
        : typeof data.id === "string"
          ? data.id
          : null,
  };
};

export const reconcileProviderWebhook = async (input: {
  providerKey: PaymentProviderKey;
  rawBody: string;
  payload: unknown;
  headers: Headers;
  baseUrl: string;
  authDataLoader: (saleorApiUrl: string) => Promise<AuthData | undefined>;
}) => {
  const provider = getProvider(input.providerKey);
  const webhookResult = await provider.handleWebhook({
    headers: input.headers,
    rawBody: input.rawBody,
    payload: input.payload,
    baseUrl: input.baseUrl,
  });
  const lookup = extractWebhookLookupData(input.providerKey, webhookResult.rawResponse);
  const session = await findPaymentSessionForProviderWebhook({
    provider: input.providerKey,
    saleorTransactionId: lookup.saleorTransactionId,
    providerPaymentId: lookup.providerPaymentId,
    providerInvoiceId: lookup.providerInvoiceId,
    providerReferenceId: lookup.providerReferenceId,
  });

  if (!session) {
    throw new ReconciliationError("Incoming provider webhook could not be matched to a payment session.", {
      provider: input.providerKey,
      lookup,
    });
  }

  const updatedSession = await upsertPaymentSession({
    id: session.id,
    saleorApiUrl: session.saleorApiUrl,
    saleorTransactionId: session.saleorTransactionId,
    saleorTransactionToken: session.saleorTransactionToken,
    saleorPspReference: session.saleorPspReference,
    saleorMerchantReference: session.saleorMerchantReference,
    saleorSourceObjectType: session.saleorSourceObjectType,
    saleorSourceObjectId: session.saleorSourceObjectId,
    checkoutId: session.checkoutId,
    orderId: session.orderId,
    customerEmail: session.customerEmail,
    channelSlug: session.channelSlug,
    provider: session.provider,
    providerPaymentId: webhookResult.providerPaymentId ?? lookup.providerPaymentId ?? session.providerPaymentId,
    providerInvoiceId: webhookResult.providerInvoiceId ?? lookup.providerInvoiceId ?? session.providerInvoiceId,
    providerReferenceId:
      webhookResult.providerReferenceId ?? lookup.providerReferenceId ?? session.providerReferenceId,
    providerStatus: webhookResult.providerStatus,
    saleorStatus: webhookResult.saleorStatus,
    amount: Number(session.amount),
    currency: session.currency,
    hostedUrl: session.hostedUrl,
    redirectUrl: session.redirectUrl,
    idempotencyKey: session.idempotencyKey,
    lastWebhookPayload: buildProviderAuditPayload({
      existingPayload: session.lastWebhookPayload,
      providerResult: webhookResult,
    }),
    complianceContract: session.complianceContract,
    safeErrorSummary: null,
    statusReason: webhookResult.message ?? session.statusReason,
    finalizationState: webhookResult.finalizationState,
    processedAt: webhookResult.finalizationState === "finalized" ? new Date() : session.processedAt,
  });

  const insertedEvent = await appendPaymentSessionEvent({
    id: makeEventId(),
    paymentSessionId: session.id,
    saleorApiUrl: session.saleorApiUrl,
    source: "provider",
    eventType: input.providerKey,
    dedupeKey: `${input.providerKey}:${webhookResult.externalEventId}`,
    providerEventId: webhookResult.externalEventId,
    providerStatus: webhookResult.providerStatus,
    saleorStatus: webhookResult.saleorStatus,
    message: webhookResult.message ?? "Provider webhook received",
    payload: buildProviderEventPayload(webhookResult),
  });

  if (!insertedEvent) {
    logger.info("Ignoring duplicate provider webhook event", {
      provider: input.providerKey,
      externalEventId: webhookResult.externalEventId,
    });
    return updatedSession;
  }

  if (webhookResult.finalizationState === "finalized") {
    const authData = await input.authDataLoader(session.saleorApiUrl);

    if (!authData) {
      throw new ReconciliationError("Could not load auth data for Saleor callback.", {
        saleorApiUrl: session.saleorApiUrl,
      });
    }

    await reportTransactionEvent({
      authData,
      session: updatedSession,
      status: updatedSession.saleorStatus,
      actionType: "CHARGE",
      message: webhookResult.message ?? updatedSession.statusReason,
      externalUrl: updatedSession.redirectUrl ?? updatedSession.hostedUrl,
    });
  }

  return updatedSession;
};

export const createFailureSyncResponse = (error: unknown, actionType: "CHARGE" | "AUTHORIZATION", amount: number) =>
  createSyncWebhookResponse({
    saleorStatus: "FAILED",
    amount,
    actionType,
    message: safeErrorSummary(error),
    data: buildFailureSyncResponseData(error),
  });
