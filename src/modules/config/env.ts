import { z } from "zod";

const emptyToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => {
    if (value === "") {
      return undefined;
    }

    return value;
  }, schema.optional());

const optionalString = () => emptyToUndefined(z.string().min(1));
const optionalUrl = () => emptyToUndefined(z.string().url());

const booleanString = (fallback: boolean) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === "") {
        return fallback;
      }

      if (typeof value === "boolean") {
        return value;
      }

      if (typeof value === "string") {
        return value.trim().toLowerCase();
      }

      return value;
    },
    z.union([
      z.boolean(),
      z
        .enum(["1", "0", "true", "false", "yes", "no", "on", "off"])
        .transform((value) => ["1", "true", "yes", "on"].includes(value)),
    ]),
  );

const providerEnum = z.enum(["nowpayments", "moonpay", "rampnetwork"]);
const nodeEnvEnum = z.enum(["development", "test", "production"]);
const logLevelEnum = z.enum(["debug", "info", "warn", "error"]);
const aplEnum = z.enum(["postgres", "file"]);
const complianceModeEnum = z.enum(["metadata", "api"]);
const nowpaymentsEnvEnum = z.enum(["sandbox", "production"]);
const moonpayEnvEnum = z.enum(["sandbox", "production"]);
const rampEnvEnum = z.enum(["sandbox", "production"]);

const rawEnvSchema = z.object({
  APP_URL: z.string().url(),
  APP_IFRAME_BASE_URL: optionalUrl(),
  APP_API_BASE_URL: optionalUrl(),
  NODE_ENV: nodeEnvEnum.default("development"),
  LOG_LEVEL: logLevelEnum.default("info"),
  DATABASE_URL: z.string().min(1),
  SALEOR_API_URL: z.string().url(),
  APL: aplEnum.default("postgres"),

  DEFAULT_PAYMENT_PROVIDER: providerEnum.default("nowpayments"),
  ENABLE_NOWPAYMENTS: booleanString(true),
  ENABLE_MOONPAY: booleanString(true),
  ENABLE_RAMPNETWORK: booleanString(true),

  COMPLIANCE_VALIDATION_MODE: complianceModeEnum.default("metadata"),
  COMPLIANCE_APP_INTERNAL_URL: optionalUrl(),
  COMPLIANCE_APP_SHARED_SECRET: optionalString(),
  PEPCLUB_INTERNAL_API_SHARED_SECRET: optionalString(),
  INTERNAL_API_SHARED_SECRET: optionalString(),
  REQUIRE_SIGNATURE_COMPLETION: booleanString(false),

  NOWPAYMENTS_API_KEY: optionalString(),
  NOWPAYMENTS_IPN_SECRET: optionalString(),
  NOWPAYMENTS_ENV: nowpaymentsEnvEnum.default("sandbox"),
  FRANKFURTER_API_URL: z.string().url().default("https://api.frankfurter.dev/v1/latest"),
  FX_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  FX_STALE_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
  FX_SOURCE_CURRENCY: z.string().default("THB"),
  FX_TARGET_CURRENCY: z.string().default("USD"),

  MOONPAY_PUBLISHABLE_KEY: optionalString(),
  MOONPAY_SECRET_KEY: optionalString(),
  MOONPAY_WEBHOOK_KEY: optionalString(),
  MOONPAY_ENV: moonpayEnvEnum.default("sandbox"),
  MOONPAY_DEFAULT_BASE_CURRENCY: z.string().default("usd"),
  MOONPAY_DEFAULT_QUOTE_CURRENCY: z.string().default("btc"),
  MOONPAY_DEFAULT_WALLET_ADDRESS: optionalString(),
  MOONPAY_RETURN_URL: optionalUrl(),
  MOONPAY_CANCEL_URL: optionalUrl(),

  RAMPNETWORK_API_KEY: optionalString(),
  RAMPNETWORK_WEBHOOK_SECRET: optionalString(),
  RAMPNETWORK_ENV: rampEnvEnum.default("sandbox"),
  RAMPNETWORK_HOST_APP_NAME: optionalString(),
  RAMPNETWORK_HOST_LOGO_URL: optionalUrl(),
  RAMPNETWORK_DEFAULT_ASSET: optionalString(),
  RAMPNETWORK_DEFAULT_FIAT_CURRENCY: optionalString(),
  RAMPNETWORK_DEFAULT_FIAT_VALUE: optionalString(),
  RAMPNETWORK_DEFAULT_USER_ADDRESS: optionalString(),
  RAMPNETWORK_FINAL_URL: optionalUrl(),

  PAYMENT_SUCCESS_URL: z.string().url(),
  PAYMENT_CANCEL_URL: z.string().url(),
  PAYMENT_STATUS_URL: z.string().url(),
});

const resolveInternalApiSharedSecret = (rawEnv: z.infer<typeof rawEnvSchema>) =>
  rawEnv.PEPCLUB_INTERNAL_API_SHARED_SECRET ??
  rawEnv.COMPLIANCE_APP_SHARED_SECRET ??
  rawEnv.INTERNAL_API_SHARED_SECRET;

const normalizeEnv = (rawEnv: z.infer<typeof rawEnvSchema>) => {
  const internalApiSharedSecret = resolveInternalApiSharedSecret(rawEnv);
  const normalizedEnv = {
    ...rawEnv,
    complianceAppSharedSecret: internalApiSharedSecret,
    enableMoonPay: rawEnv.ENABLE_MOONPAY,
    enableNowPayments: rawEnv.ENABLE_NOWPAYMENTS,
    enableRampNetwork: rawEnv.ENABLE_RAMPNETWORK,
    requireSignatureCompletion: rawEnv.REQUIRE_SIGNATURE_COMPLETION,
  };
  const hasEnabledProvider =
    normalizedEnv.enableNowPayments ||
    normalizedEnv.enableMoonPay ||
    normalizedEnv.enableRampNetwork;

  if (normalizedEnv.FX_STALE_TTL_SECONDS < normalizedEnv.FX_CACHE_TTL_SECONDS) {
    throw new Error("FX_STALE_TTL_SECONDS must be greater than or equal to FX_CACHE_TTL_SECONDS.");
  }

  if (normalizedEnv.COMPLIANCE_VALIDATION_MODE === "api") {
    if (!normalizedEnv.COMPLIANCE_APP_INTERNAL_URL) {
      throw new Error(
        "COMPLIANCE_APP_INTERNAL_URL is required when COMPLIANCE_VALIDATION_MODE=api.",
      );
    }

    if (!normalizedEnv.complianceAppSharedSecret) {
      throw new Error(
        "PEPCLUB_INTERNAL_API_SHARED_SECRET is required when COMPLIANCE_VALIDATION_MODE=api. COMPLIANCE_APP_SHARED_SECRET and INTERNAL_API_SHARED_SECRET are still accepted as aliases.",
      );
    }
  }

  if (normalizedEnv.enableNowPayments) {
    if (!normalizedEnv.NOWPAYMENTS_API_KEY || !normalizedEnv.NOWPAYMENTS_IPN_SECRET) {
      throw new Error(
        "NOWPAYMENTS_API_KEY and NOWPAYMENTS_IPN_SECRET are required when NOWPayments is enabled.",
      );
    }
  }

  if (normalizedEnv.enableMoonPay) {
    if (
      !normalizedEnv.MOONPAY_PUBLISHABLE_KEY ||
      !normalizedEnv.MOONPAY_SECRET_KEY ||
      !normalizedEnv.MOONPAY_WEBHOOK_KEY ||
      !normalizedEnv.MOONPAY_RETURN_URL ||
      !normalizedEnv.MOONPAY_CANCEL_URL ||
      !normalizedEnv.MOONPAY_DEFAULT_WALLET_ADDRESS
    ) {
      throw new Error(
        "MoonPay requires MOONPAY_PUBLISHABLE_KEY, MOONPAY_SECRET_KEY, MOONPAY_WEBHOOK_KEY, MOONPAY_DEFAULT_WALLET_ADDRESS, MOONPAY_RETURN_URL, and MOONPAY_CANCEL_URL when enabled.",
      );
    }
  }

  if (normalizedEnv.enableRampNetwork) {
    if (
      !normalizedEnv.RAMPNETWORK_API_KEY ||
      !normalizedEnv.RAMPNETWORK_WEBHOOK_SECRET ||
      !normalizedEnv.RAMPNETWORK_HOST_APP_NAME ||
      !normalizedEnv.RAMPNETWORK_HOST_LOGO_URL ||
      !normalizedEnv.RAMPNETWORK_DEFAULT_ASSET ||
      !normalizedEnv.RAMPNETWORK_DEFAULT_FIAT_CURRENCY ||
      !normalizedEnv.RAMPNETWORK_DEFAULT_FIAT_VALUE ||
      !normalizedEnv.RAMPNETWORK_DEFAULT_USER_ADDRESS ||
      !normalizedEnv.RAMPNETWORK_FINAL_URL
    ) {
      throw new Error(
        "Ramp Network requires RAMPNETWORK_API_KEY, RAMPNETWORK_WEBHOOK_SECRET, RAMPNETWORK_HOST_APP_NAME, RAMPNETWORK_HOST_LOGO_URL, RAMPNETWORK_DEFAULT_ASSET, RAMPNETWORK_DEFAULT_FIAT_CURRENCY, RAMPNETWORK_DEFAULT_FIAT_VALUE, RAMPNETWORK_DEFAULT_USER_ADDRESS, and RAMPNETWORK_FINAL_URL when enabled.",
      );
    }
  }

  if (
    hasEnabledProvider &&
    normalizedEnv.DEFAULT_PAYMENT_PROVIDER === "nowpayments" &&
    !normalizedEnv.enableNowPayments
  ) {
    throw new Error(
      "DEFAULT_PAYMENT_PROVIDER cannot be nowpayments when ENABLE_NOWPAYMENTS=false.",
    );
  }

  if (
    hasEnabledProvider &&
    normalizedEnv.DEFAULT_PAYMENT_PROVIDER === "moonpay" &&
    !normalizedEnv.enableMoonPay
  ) {
    throw new Error("DEFAULT_PAYMENT_PROVIDER cannot be moonpay when ENABLE_MOONPAY=false.");
  }

  if (
    hasEnabledProvider &&
    normalizedEnv.DEFAULT_PAYMENT_PROVIDER === "rampnetwork" &&
    !normalizedEnv.enableRampNetwork
  ) {
    throw new Error(
      "DEFAULT_PAYMENT_PROVIDER cannot be rampnetwork when ENABLE_RAMPNETWORK=false.",
    );
  }

  return {
    apl: normalizedEnv.APL,
    appApiBaseUrl: normalizedEnv.APP_API_BASE_URL ?? normalizedEnv.APP_URL,
    appIframeBaseUrl: normalizedEnv.APP_IFRAME_BASE_URL ?? normalizedEnv.APP_URL,
    appUrl: normalizedEnv.APP_URL,
    complianceAppInternalUrl: normalizedEnv.COMPLIANCE_APP_INTERNAL_URL,
    complianceAppSharedSecret: normalizedEnv.complianceAppSharedSecret,
    complianceValidationMode: normalizedEnv.COMPLIANCE_VALIDATION_MODE,
    databaseUrl: normalizedEnv.DATABASE_URL,
    defaultPaymentProvider: normalizedEnv.DEFAULT_PAYMENT_PROVIDER,
    enableMoonPay: normalizedEnv.enableMoonPay,
    enableNowPayments: normalizedEnv.enableNowPayments,
    enableRampNetwork: normalizedEnv.enableRampNetwork,
    logLevel: normalizedEnv.LOG_LEVEL,
    moonpay: {
      apiBaseUrl:
        normalizedEnv.MOONPAY_ENV === "production"
          ? "https://api.moonpay.com"
          : "https://api.moonpay.com",
      cancelUrl: normalizedEnv.MOONPAY_CANCEL_URL,
      defaultBaseCurrency: normalizedEnv.MOONPAY_DEFAULT_BASE_CURRENCY,
      defaultQuoteCurrency: normalizedEnv.MOONPAY_DEFAULT_QUOTE_CURRENCY,
      defaultWalletAddress: normalizedEnv.MOONPAY_DEFAULT_WALLET_ADDRESS,
      environment: normalizedEnv.MOONPAY_ENV,
      publishableKey: normalizedEnv.MOONPAY_PUBLISHABLE_KEY,
      returnUrl: normalizedEnv.MOONPAY_RETURN_URL,
      secretKey: normalizedEnv.MOONPAY_SECRET_KEY,
      webhookKey: normalizedEnv.MOONPAY_WEBHOOK_KEY,
      widgetBaseUrl:
        normalizedEnv.MOONPAY_ENV === "production"
          ? "https://buy.moonpay.com"
          : "https://buy-sandbox.moonpay.com",
    },
    nodeEnv: normalizedEnv.NODE_ENV,
    nowpayments: {
      apiKey: normalizedEnv.NOWPAYMENTS_API_KEY,
      baseUrl:
        normalizedEnv.NOWPAYMENTS_ENV === "production"
          ? "https://api.nowpayments.io/v1"
          : "https://api-sandbox.nowpayments.io/v1",
      environment: normalizedEnv.NOWPAYMENTS_ENV,
      ipnSecret: normalizedEnv.NOWPAYMENTS_IPN_SECRET,
    },
    fx: {
      apiUrl: normalizedEnv.FRANKFURTER_API_URL,
      cacheTtlSeconds: normalizedEnv.FX_CACHE_TTL_SECONDS,
      providerName: "frankfurter",
      sourceCurrency: normalizedEnv.FX_SOURCE_CURRENCY.toUpperCase(),
      staleTtlSeconds: normalizedEnv.FX_STALE_TTL_SECONDS,
      targetCurrency: normalizedEnv.FX_TARGET_CURRENCY.toUpperCase(),
    },
    paymentCancelUrl: normalizedEnv.PAYMENT_CANCEL_URL,
    paymentStatusUrl: normalizedEnv.PAYMENT_STATUS_URL,
    paymentSuccessUrl: normalizedEnv.PAYMENT_SUCCESS_URL,
    rampnetwork: {
      apiBaseUrl:
        normalizedEnv.RAMPNETWORK_ENV === "production"
          ? "https://api.rampnetwork.com/api"
          : "https://api.demo.rampnetwork.com/api",
      apiKey: normalizedEnv.RAMPNETWORK_API_KEY,
      defaultAsset: normalizedEnv.RAMPNETWORK_DEFAULT_ASSET,
      defaultFiatCurrency: normalizedEnv.RAMPNETWORK_DEFAULT_FIAT_CURRENCY,
      defaultFiatValue: normalizedEnv.RAMPNETWORK_DEFAULT_FIAT_VALUE,
      defaultUserAddress: normalizedEnv.RAMPNETWORK_DEFAULT_USER_ADDRESS,
      environment: normalizedEnv.RAMPNETWORK_ENV,
      finalUrl: normalizedEnv.RAMPNETWORK_FINAL_URL,
      hostAppName: normalizedEnv.RAMPNETWORK_HOST_APP_NAME,
      hostLogoUrl: normalizedEnv.RAMPNETWORK_HOST_LOGO_URL,
      webhookSecret: normalizedEnv.RAMPNETWORK_WEBHOOK_SECRET,
      widgetBaseUrl:
        normalizedEnv.RAMPNETWORK_ENV === "production"
          ? "https://app.rampnetwork.com"
          : "https://app.demo.rampnetwork.com",
    },
    requireSignatureCompletion: normalizedEnv.requireSignatureCompletion,
    saleorApiUrl: normalizedEnv.SALEOR_API_URL,
  } as const;
};

export const parseEnv = (input: Record<string, string | undefined>) =>
  normalizeEnv(rawEnvSchema.parse(input));

export type AppEnv = ReturnType<typeof parseEnv>;

let cachedEnv: AppEnv | null = null;

export const getEnv = () => {
  if (!cachedEnv) {
    cachedEnv = parseEnv(process.env);
  }

  return cachedEnv;
};

export const resetEnvCache = () => {
  cachedEnv = null;
};
