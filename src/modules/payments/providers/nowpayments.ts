import crypto from "crypto";

import { getEnv } from "@/modules/config/env";
import {
  ProviderApiError,
  ProviderConfigError,
  SignatureVerificationError,
} from "@/modules/core/errors";
import { getFinalizationState, mapNowPaymentsStatus } from "@/modules/payments/status-mapping";
import {
  PaymentProvider,
  PaymentSessionRecord,
  ProviderDashboardStatus,
  ProviderInitializeInput,
  ProviderStatusResult,
  ProviderValidationResult,
} from "@/modules/payments/types";
import { sortObjectKeys } from "@/modules/utils/object";

type NowPaymentsInvoiceResponse = {
  id: string | number;
  invoice_url: string;
};

type NowPaymentsPaymentStatusResponse = {
  payment_id?: string | number;
  invoice_id?: string | number | null;
  payment_status: string;
  pay_address?: string | null;
  order_id?: string | null;
  purchase_id?: string | null;
};

const getNowPaymentsValidation = (): ProviderValidationResult => {
  const env = getEnv();
  const missingFields = [
    !env.nowpayments.apiKey ? "NOWPAYMENTS_API_KEY" : null,
    !env.nowpayments.ipnSecret ? "NOWPAYMENTS_IPN_SECRET" : null,
  ].filter(Boolean) as string[];

  return {
    isConfigured: missingFields.length === 0,
    missingFields,
    summary:
      missingFields.length === 0
        ? "NOWPayments is ready for hosted crypto payments."
        : `Missing ${missingFields.join(", ")}`,
  };
};

const nowPaymentsFetch = async <T>(
  path: string,
  init?: Omit<RequestInit, "body"> & { body?: Record<string, unknown> }
) => {
  const env = getEnv();
  const response = await fetch(`${env.nowpayments.baseUrl}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.nowpayments.apiKey!,
      ...(init?.headers ?? {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });

  const payload = (await response.json()) as T & { message?: string };

  if (!response.ok) {
    throw new ProviderApiError(`NOWPayments request failed for ${path}.`, {
      status: response.status,
      payload,
    });
  }

  return payload;
};

export const verifyNowPaymentsSignature = (payload: unknown, signature: string, secret: string) => {
  const expectedSignature = crypto
    .createHmac("sha512", secret)
    .update(JSON.stringify(sortObjectKeys(payload as Record<string, unknown>)))
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature));
};

const mapNowPaymentsResult = (
  payload: Partial<NowPaymentsPaymentStatusResponse>,
  fallbackHostedUrl?: string | null
): ProviderStatusResult => {
  const providerStatus = payload.payment_status ?? "waiting";
  const saleorStatus = mapNowPaymentsStatus(providerStatus);

  return {
    providerStatus,
    saleorStatus,
    hostedUrl: fallbackHostedUrl ?? null,
    redirectUrl: fallbackHostedUrl ?? null,
    providerPaymentId: payload.payment_id ? String(payload.payment_id) : null,
    providerInvoiceId: payload.invoice_id ? String(payload.invoice_id) : null,
    providerReferenceId: payload.payment_id
      ? String(payload.payment_id)
      : payload.purchase_id ?? payload.order_id ?? null,
    message: providerStatus,
    rawResponse: payload,
    finalizationState: getFinalizationState(saleorStatus),
  };
};

export class NowPaymentsProvider implements PaymentProvider {
  readonly key = "nowpayments" as const;

  validateConfig(): ProviderValidationResult {
    return getNowPaymentsValidation();
  }

  getDashboardStatus(): ProviderDashboardStatus {
    const validation = this.validateConfig();
    const env = getEnv();

    return {
      ...validation,
      provider: this.key,
      enabled: env.enableNowPayments,
      environment: env.nowpayments.environment,
    };
  }

  async initializeSession(input: ProviderInitializeInput): Promise<ProviderStatusResult> {
    const env = getEnv();
    const validation = this.validateConfig();

    if (!validation.isConfigured) {
      throw new ProviderConfigError("NOWPayments configuration is incomplete.", validation);
    }

    const webhookUrl = `${input.baseUrl}/api/webhooks/providers/nowpayments`;
    const providerAmount = input.providerAmount ?? input.amount;
    const providerCurrency = (input.providerCurrency ?? input.currency).toLowerCase();
    const invoice = await nowPaymentsFetch<NowPaymentsInvoiceResponse>("/invoice", {
      method: "POST",
      body: {
        price_amount: providerAmount,
        price_currency: providerCurrency,
        pay_currency: input.gatewayData.quoteCurrency?.toLowerCase(),
        ipn_callback_url: webhookUrl,
        order_id: input.transactionId,
        order_description: `Pepclub payment ${input.merchantReference}`,
        success_url: env.paymentSuccessUrl,
        cancel_url: env.paymentCancelUrl,
        is_fixed_rate: true,
      },
    });

    return {
      providerStatus: "invoice_created",
      saleorStatus: "ACTION_REQUIRED",
      hostedUrl: invoice.invoice_url,
      redirectUrl: invoice.invoice_url,
      providerInvoiceId: String(invoice.id),
      providerReferenceId: String(invoice.id),
      providerAmount,
      providerCurrency: providerCurrency.toUpperCase(),
      fxQuote: input.fxQuote ?? null,
      message: "Hosted NOWPayments invoice created.",
      rawResponse: invoice,
      finalizationState: "pending",
    };
  }

  async processSession(session: PaymentSessionRecord): Promise<ProviderStatusResult> {
    return this.getStatus(session);
  }

  async getStatus(session: PaymentSessionRecord): Promise<ProviderStatusResult> {
    if (!session.providerPaymentId) {
      return {
        providerStatus: session.providerStatus,
        saleorStatus: session.saleorStatus,
        hostedUrl: session.hostedUrl,
        redirectUrl: session.redirectUrl,
        providerPaymentId: session.providerPaymentId,
        providerInvoiceId: session.providerInvoiceId,
        providerReferenceId: session.providerReferenceId,
        message: "Waiting for NOWPayments to create the payment record.",
        rawResponse: null,
        finalizationState: session.finalizationState,
      };
    }

    const payload = await nowPaymentsFetch<NowPaymentsPaymentStatusResponse>(
      `/payment/${session.providerPaymentId}`
    );

    return mapNowPaymentsResult(payload, session.hostedUrl);
  }

  async handleWebhook(input: { headers: Headers; rawBody: string; payload: unknown }) {
    const env = getEnv();
    const signature = input.headers.get("x-nowpayments-sig");

    if (!signature || !env.nowpayments.ipnSecret) {
      throw new SignatureVerificationError("NOWPayments signature header is missing.");
    }

    if (!verifyNowPaymentsSignature(input.payload, signature, env.nowpayments.ipnSecret)) {
      throw new SignatureVerificationError("NOWPayments signature verification failed.");
    }

    const payload = input.payload as NowPaymentsPaymentStatusResponse;
    const mapped = mapNowPaymentsResult(payload);

    return {
      ...mapped,
      externalEventId: `${payload.payment_id ?? payload.invoice_id ?? payload.purchase_id}:${
        payload.payment_status
      }`,
    };
  }
}
