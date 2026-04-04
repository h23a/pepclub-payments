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
import { reportTransactionEvent } from "@/modules/saleor/client";
import {
  getPaymentGatewayData,
  getSaleorActionType,
  getSourceObjectIdentifiers,
  SaleorTransactionSessionPayload,
} from "@/modules/saleor/types";

import { resolveProviderKey } from "./provider-resolver";
import { getProvider } from "./providers";
import { mapSaleorStatusToSyncResult } from "./status-mapping";
import {
  PaymentGatewayData,
  PaymentProviderKey,
  PaymentSessionRecord,
  ProviderStatusResult,
} from "./types";

const makeSessionId = () => crypto.randomUUID();
const makeEventId = () => crypto.randomUUID();

const safeErrorSummary = (error: unknown) => {
  if (error instanceof AppError) {
    return error.safeMessage;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown payment error";
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
  });

export const initializePaymentSession = async (input: {
  payload: SaleorTransactionSessionPayload;
  authData: AuthData;
  baseUrl: string;
}) => {
  const gatewayData = getPaymentGatewayData(input.payload);
  const settings = await resolveSettingsForTenant(input.authData.saleorApiUrl);
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
    lastWebhookPayload: providerResult.rawResponse,
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
      providerResult: providerResult.rawResponse,
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
      data: {
        provider: providerKey,
        providerStatus: providerResult.providerStatus,
        redirectUrl: providerResult.redirectUrl,
        hostedUrl: providerResult.hostedUrl,
      },
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
    lastWebhookPayload: providerResult.rawResponse ?? existingSession.lastWebhookPayload,
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
    payload: providerResult.rawResponse,
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
      data: {
        provider: existingSession.provider,
        providerStatus: providerResult.providerStatus,
      },
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
    lastWebhookPayload: providerResult.rawResponse ?? session.lastWebhookPayload,
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
    payload: providerResult.rawResponse,
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
    lastWebhookPayload: webhookResult.rawResponse,
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
    payload: webhookResult.rawResponse,
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
  });
