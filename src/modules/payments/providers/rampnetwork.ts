import crypto from "crypto";

import { getEnv } from "@/modules/config/env";
import {
  ProviderApiError,
  ProviderConfigError,
  SignatureVerificationError,
} from "@/modules/core/errors";
import { getFinalizationState } from "@/modules/payments/status-mapping";
import {
  PaymentProvider,
  PaymentSessionRecord,
  ProviderDashboardStatus,
  ProviderInitializeInput,
  ProviderStatusResult,
  ProviderValidationResult,
} from "@/modules/payments/types";
import { sortObjectKeys } from "@/modules/utils/object";

const RAMP_PRODUCTION_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAElvxpYOhgdAmI+7oL4mABRAfM5CwLkCbZ
m64ERVKAisSulWFC3oRZom/PeyE2iXPX1ekp9UD1r+51c9TiuIHU4w==
-----END PUBLIC KEY-----`;

const RAMP_DEMO_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEevN2PMEeIaaMkS4VIfXOqsLebj19kVeu
wWl0AnkIA6DJU0r3ixkXVhJTltycJtkDoEAYtPHfARyTofB5ZNw9xA==
-----END PUBLIC KEY-----`;

type RampPurchase = {
  id?: string;
  purchaseViewToken?: string;
  status?: string;
  endTime?: string | null;
  createdAt?: string;
  updatedAt?: string;
  userAddress?: string | null;
};

type RampWebhookPayload = {
  type: "CREATED" | "RELEASED" | "RETURNED";
  purchase: RampPurchase;
};

type RampPurchaseResponse = {
  purchase: RampPurchase;
};

const getRampValidation = (): ProviderValidationResult => {
  const env = getEnv();
  const missingFields = [
    !env.rampnetwork.apiKey ? "RAMPNETWORK_API_KEY" : null,
    !env.rampnetwork.webhookSecret ? "RAMPNETWORK_WEBHOOK_SECRET" : null,
    !env.rampnetwork.hostAppName ? "RAMPNETWORK_HOST_APP_NAME" : null,
    !env.rampnetwork.hostLogoUrl ? "RAMPNETWORK_HOST_LOGO_URL" : null,
    !env.rampnetwork.defaultAsset ? "RAMPNETWORK_DEFAULT_ASSET" : null,
    !env.rampnetwork.defaultFiatCurrency ? "RAMPNETWORK_DEFAULT_FIAT_CURRENCY" : null,
    !env.rampnetwork.defaultFiatValue ? "RAMPNETWORK_DEFAULT_FIAT_VALUE" : null,
    !env.rampnetwork.defaultUserAddress ? "RAMPNETWORK_DEFAULT_USER_ADDRESS" : null,
    !env.rampnetwork.finalUrl ? "RAMPNETWORK_FINAL_URL" : null,
  ].filter(Boolean) as string[];

  return {
    isConfigured: missingFields.length === 0,
    missingFields,
    summary:
      missingFields.length === 0
        ? "Ramp Network is ready for hosted on-ramp payments."
        : `Missing ${missingFields.join(", ")}`,
  };
};

const getRampSaleorStatus = (
  purchaseStatus?: string | null,
  webhookType?: RampWebhookPayload["type"]
): ProviderStatusResult["saleorStatus"] => {
  const normalizedStatus = purchaseStatus?.toUpperCase() ?? "";

  if (webhookType === "RELEASED" || normalizedStatus === "RELEASED") {
    return "SUCCESS";
  }

  if (
    webhookType === "RETURNED" ||
    ["PAYMENT_FAILED", "FAILED", "CANCELLED", "CANCELED", "RETURNED"].includes(normalizedStatus)
  ) {
    return "FAILED";
  }

  if (["EXPIRED"].includes(normalizedStatus)) {
    return "EXPIRED";
  }

  if (["INITIALIZED", "CREATED"].includes(normalizedStatus) || webhookType === "CREATED") {
    return "ACTION_REQUIRED";
  }

  if (
    [
      "PAYMENT_STARTED",
      "PAYMENT_IN_PROGRESS",
      "PAYMENT_EXECUTED",
      "FIAT_SENT",
      "FIAT_RECEIVED",
      "RELEASING",
    ].includes(normalizedStatus)
  ) {
    return "PENDING";
  }

  return "UNKNOWN";
};

const buildRampStatusResult = (
  purchase: RampPurchase,
  redirectUrl?: string | null,
  webhookType?: RampWebhookPayload["type"]
): ProviderStatusResult => {
  const providerStatus = webhookType ?? purchase.status ?? "INITIALIZED";
  const saleorStatus = getRampSaleorStatus(purchase.status, webhookType);

  return {
    providerStatus,
    saleorStatus,
    hostedUrl: redirectUrl ?? null,
    redirectUrl: redirectUrl ?? null,
    providerPaymentId: purchase.id ?? null,
    providerReferenceId: purchase.purchaseViewToken ?? null,
    message: providerStatus,
    rawResponse: purchase,
    finalizationState: getFinalizationState(saleorStatus),
  };
};

const getRampPublicKey = () =>
  getEnv().rampnetwork.environment === "production"
    ? RAMP_PRODUCTION_PUBLIC_KEY
    : RAMP_DEMO_PUBLIC_KEY;

export const buildRampHostedUrl = (input: ProviderInitializeInput) => {
  const env = getEnv();
  const query = new URLSearchParams({
    hostApiKey: env.rampnetwork.apiKey!,
    hostAppName: env.rampnetwork.hostAppName!,
    hostLogoUrl: env.rampnetwork.hostLogoUrl!,
    defaultFlow: "ONRAMP",
    fiatCurrency:
      input.gatewayData.fiatCurrency ??
      input.gatewayData.baseCurrency ??
      env.rampnetwork.defaultFiatCurrency!,
    fiatValue: input.gatewayData.fiatValue ?? env.rampnetwork.defaultFiatValue!,
    swapAsset:
      input.gatewayData.asset ??
      input.gatewayData.quoteCurrency ??
      env.rampnetwork.defaultAsset!,
    userAddress: input.gatewayData.walletAddress ?? env.rampnetwork.defaultUserAddress!,
    finalUrl: env.rampnetwork.finalUrl!,
    webhookStatusUrl: `${input.baseUrl}/api/webhooks/providers/rampnetwork`,
    hostLogoScale: "fit",
    useSendCryptoCallback: "false",
  });

  if (input.customerEmail ?? input.gatewayData.email) {
    query.set("userEmailAddress", input.gatewayData.email ?? input.customerEmail ?? "");
  }

  return `${env.rampnetwork.widgetBaseUrl}?${query.toString()}`;
};

export const verifyRampWebhookSignature = (payload: unknown, signature: string) => {
  const serialized = JSON.stringify(sortObjectKeys(payload as Record<string, unknown>));

  return crypto.verify(
    "sha256",
    Buffer.from(serialized),
    getRampPublicKey(),
    Buffer.from(signature, "base64")
  );
};

const rampFetch = async (path: string) => {
  const env = getEnv();
  const response = await fetch(`${env.rampnetwork.apiBaseUrl}${path}`, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${env.rampnetwork.apiKey}`,
    },
  });

  const payload = (await response.json()) as RampPurchaseResponse | RampPurchase | { message?: string };

  if (!response.ok) {
    throw new ProviderApiError(`Ramp Network request failed for ${path}.`, {
      status: response.status,
      payload,
    });
  }

  return payload;
};

export class RampNetworkProvider implements PaymentProvider {
  readonly key = "rampnetwork" as const;

  validateConfig(): ProviderValidationResult {
    return getRampValidation();
  }

  getDashboardStatus(): ProviderDashboardStatus {
    const validation = this.validateConfig();
    const env = getEnv();

    return {
      ...validation,
      provider: this.key,
      enabled: env.enableRampNetwork,
      environment: env.rampnetwork.environment,
    };
  }

  async initializeSession(input: ProviderInitializeInput): Promise<ProviderStatusResult> {
    const validation = this.validateConfig();

    if (!validation.isConfigured) {
      throw new ProviderConfigError("Ramp Network configuration is incomplete.", validation);
    }

    const hostedUrl = buildRampHostedUrl(input);

    return {
      providerStatus: "INITIALIZED",
      saleorStatus: "ACTION_REQUIRED",
      hostedUrl,
      redirectUrl: hostedUrl,
      providerReferenceId: input.transactionId,
      message: "Hosted Ramp Network URL created.",
      rawResponse: { url: hostedUrl },
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
        providerReferenceId: session.providerReferenceId,
        message: "Waiting for Ramp Network purchase creation.",
        rawResponse: null,
        finalizationState: session.finalizationState,
      };
    }

    const search = new URLSearchParams();

    if (session.providerReferenceId) {
      search.set("secret", session.providerReferenceId);
    }

    const payload = await rampFetch(
      `/host-api/purchases/${encodeURIComponent(session.providerPaymentId)}${
        search.size > 0 ? `?${search.toString()}` : ""
      }`
    );
    const purchase = "purchase" in payload ? payload.purchase : (payload as RampPurchase);

    return buildRampStatusResult(purchase, session.hostedUrl);
  }

  async handleWebhook(input: { headers: Headers; rawBody: string; payload: unknown }) {
    const signature = input.headers.get("x-body-signature");

    if (!signature) {
      throw new SignatureVerificationError("Ramp Network signature header is missing.");
    }

    if (!verifyRampWebhookSignature(input.payload, signature)) {
      throw new SignatureVerificationError("Ramp Network signature verification failed.");
    }

    const payload = input.payload as RampWebhookPayload;
    const mapped = buildRampStatusResult(payload.purchase, null, payload.type);

    return {
      ...mapped,
      externalEventId: `${payload.purchase.id ?? payload.purchase.purchaseViewToken ?? "unknown"}:${payload.type}`,
    };
  }
}
