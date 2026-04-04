import crypto from "crypto";

import { getEnv } from "@/modules/config/env";
import { ProviderConfigError, SignatureVerificationError } from "@/modules/core/errors";
import { getFinalizationState, mapMoonPayStatus } from "@/modules/payments/status-mapping";
import {
  PaymentProvider,
  PaymentSessionRecord,
  ProviderDashboardStatus,
  ProviderInitializeInput,
  ProviderStatusResult,
  ProviderValidationResult,
} from "@/modules/payments/types";

type MoonPayTransaction = {
  id?: string;
  status?: string;
  externalTransactionId?: string;
  walletAddress?: string;
  baseCurrency?: { code?: string };
  quoteCurrency?: { code?: string };
};

type MoonPayWebhookPayload = {
  data?: {
    id?: string;
    status?: string;
    externalTransactionId?: string;
  };
  type?: string;
};

const getMoonPayValidation = (): ProviderValidationResult => {
  const env = getEnv();
  const missingFields = [
    !env.moonpay.publishableKey ? "MOONPAY_PUBLISHABLE_KEY" : null,
    !env.moonpay.secretKey ? "MOONPAY_SECRET_KEY" : null,
    !env.moonpay.webhookKey ? "MOONPAY_WEBHOOK_KEY" : null,
    !env.moonpay.defaultWalletAddress ? "MOONPAY_DEFAULT_WALLET_ADDRESS" : null,
    !env.moonpay.returnUrl ? "MOONPAY_RETURN_URL" : null,
    !env.moonpay.cancelUrl ? "MOONPAY_CANCEL_URL" : null,
  ].filter(Boolean) as string[];

  return {
    isConfigured: missingFields.length === 0,
    missingFields,
    summary:
      missingFields.length === 0
        ? "MoonPay is ready for hosted on-ramp payments."
        : `Missing ${missingFields.join(", ")}`,
  };
};

const buildMoonPayBaseUrl = (input: ProviderInitializeInput) => {
  const env = getEnv();
  const params = new URLSearchParams({
    apiKey: env.moonpay.publishableKey!,
    baseCurrencyCode: (
      input.gatewayData.baseCurrency ??
      env.moonpay.defaultBaseCurrency
    ).toLowerCase(),
    currencyCode: (
      input.gatewayData.quoteCurrency ??
      env.moonpay.defaultQuoteCurrency
    ).toLowerCase(),
    walletAddress: input.gatewayData.walletAddress ?? env.moonpay.defaultWalletAddress!,
    email: input.gatewayData.email ?? input.customerEmail ?? "",
    externalTransactionId: input.transactionId,
    redirectURL: env.moonpay.returnUrl!,
    colorCode: "%2300475b",
    lockAmount: "true",
    baseCurrencyAmount: String(Math.round(input.amount)),
  });

  if (env.moonpay.cancelUrl) {
    params.set("unsupportedRegionRedirectUrl", env.moonpay.cancelUrl);
  }

  return `${env.moonpay.widgetBaseUrl}?${params.toString()}`;
};

export const generateMoonPaySignature = (url: string, secretKey: string) =>
  crypto.createHmac("sha256", secretKey).update(new URL(url).search).digest("base64");

export const buildSignedMoonPayUrl = (input: ProviderInitializeInput) => {
  const env = getEnv();
  const baseUrl = buildMoonPayBaseUrl(input);
  const signature = generateMoonPaySignature(baseUrl, env.moonpay.secretKey!);
  return `${baseUrl}&signature=${encodeURIComponent(signature)}`;
};

export const verifyMoonPayWebhookSignature = (
  rawBody: string,
  header: string,
  webhookKey: string
) => {
  const entries = header.split(",").reduce<Record<string, string>>((acc, item) => {
    const [key, value] = item.split("=");
    if (key && value) {
      acc[key.trim()] = value.trim();
    }
    return acc;
  }, {});

  const timestamp = entries.t;
  const signature = entries.s;

  if (!timestamp || !signature) {
    return false;
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", webhookKey).update(signedPayload).digest("hex");

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
};

const mapMoonPayResult = (
  payload: MoonPayTransaction | MoonPayWebhookPayload["data"] | undefined,
  redirectUrl?: string | null
): ProviderStatusResult => {
  const providerStatus = payload?.status ?? "pending";
  const saleorStatus = mapMoonPayStatus(providerStatus);

  return {
    providerStatus,
    saleorStatus,
    hostedUrl: redirectUrl ?? null,
    redirectUrl: redirectUrl ?? null,
    providerPaymentId: payload?.id ?? null,
    providerReferenceId: payload?.externalTransactionId ?? payload?.id ?? null,
    message: providerStatus,
    rawResponse: payload,
    finalizationState: getFinalizationState(saleorStatus),
  };
};

export class MoonPayProvider implements PaymentProvider {
  readonly key = "moonpay" as const;

  validateConfig(): ProviderValidationResult {
    return getMoonPayValidation();
  }

  getDashboardStatus(): ProviderDashboardStatus {
    const validation = this.validateConfig();
    const env = getEnv();

    return {
      ...validation,
      provider: this.key,
      enabled: env.enableMoonPay,
      environment: env.moonpay.environment,
    };
  }

  async initializeSession(input: ProviderInitializeInput): Promise<ProviderStatusResult> {
    const validation = this.validateConfig();

    if (!validation.isConfigured) {
      throw new ProviderConfigError("MoonPay configuration is incomplete.", validation);
    }

    const signedUrl = buildSignedMoonPayUrl(input);

    return {
      providerStatus: "widget_url_created",
      saleorStatus: "ACTION_REQUIRED",
      hostedUrl: signedUrl,
      redirectUrl: signedUrl,
      providerReferenceId: input.transactionId,
      message: "Hosted MoonPay widget URL created.",
      rawResponse: { url: signedUrl },
      finalizationState: "pending",
    };
  }

  async processSession(session: PaymentSessionRecord): Promise<ProviderStatusResult> {
    return this.getStatus(session);
  }

  async getStatus(session: PaymentSessionRecord): Promise<ProviderStatusResult> {
    const env = getEnv();
    if (!session.providerReferenceId) {
      return {
        providerStatus: session.providerStatus,
        saleorStatus: session.saleorStatus,
        hostedUrl: session.hostedUrl,
        redirectUrl: session.redirectUrl,
        providerPaymentId: session.providerPaymentId,
        providerReferenceId: session.providerReferenceId,
        message: "Waiting for MoonPay transaction state.",
        rawResponse: null,
        finalizationState: session.finalizationState,
      };
    }

    const url = new URL(
      `${env.moonpay.apiBaseUrl}/v1/transactions/ext/${encodeURIComponent(session.providerReferenceId)}`
    );
    url.searchParams.set("apiKey", env.moonpay.publishableKey!);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        accept: "application/json",
      },
    });

    const payload = (await response.json()) as MoonPayTransaction[];
    const transaction = Array.isArray(payload) ? payload[0] : undefined;

    if (!response.ok) {
      throw new ProviderConfigError("MoonPay transaction lookup failed.", {
        status: response.status,
        payload,
      });
    }

    return mapMoonPayResult(transaction, session.hostedUrl);
  }

  async handleWebhook(input: { headers: Headers; rawBody: string; payload: unknown }) {
    const env = getEnv();
    const signature = input.headers.get("moonpay-signature-v2");

    if (!signature || !env.moonpay.webhookKey) {
      throw new SignatureVerificationError("MoonPay signature header is missing.");
    }

    if (!verifyMoonPayWebhookSignature(input.rawBody, signature, env.moonpay.webhookKey)) {
      throw new SignatureVerificationError("MoonPay signature verification failed.");
    }

    const payload = input.payload as MoonPayWebhookPayload;
    const mapped = mapMoonPayResult(payload.data);

    return {
      ...mapped,
      externalEventId: `${payload.type ?? "moonpay"}:${payload.data?.id ?? payload.data?.externalTransactionId ?? "unknown"}`,
    };
  }
}
