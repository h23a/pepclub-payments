import { afterEach, describe, expect, it, vi } from "vitest";

const baseEnv = {
  APP_URL: "http://localhost:3000",
  APP_IFRAME_BASE_URL: "http://localhost:3000",
  APP_API_BASE_URL: "http://localhost:3000",
  NODE_ENV: "test",
  LOG_LEVEL: "info",
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/pepclub",
  SALEOR_API_URL: "https://example.saleor.cloud/graphql/",
  APL: "postgres",
  DEFAULT_PAYMENT_PROVIDER: "nowpayments",
  ENABLE_NOWPAYMENTS: "true",
  ENABLE_MOONPAY: "false",
  ENABLE_RAMPNETWORK: "false",
  COMPLIANCE_VALIDATION_MODE: "metadata",
  REQUIRE_SIGNATURE_COMPLETION: "false",
  FX_CACHE_TTL_SECONDS: "3600",
  FX_STALE_TTL_SECONDS: "86400",
  FX_SOURCE_CURRENCY: "THB",
  FX_TARGET_CURRENCY: "USD",
  NOWPAYMENTS_API_KEY: "np_key",
  NOWPAYMENTS_IPN_SECRET: "np_secret",
  NOWPAYMENTS_ENV: "sandbox",
  PAYMENT_SUCCESS_URL: "https://example.com/success",
  PAYMENT_CANCEL_URL: "https://example.com/cancel",
  PAYMENT_STATUS_URL: "https://example.com/status",
};

const importEnvModule = async (overrides: Record<string, string | undefined> = {}) => {
  vi.resetModules();
  process.env = {
    ...process.env,
    ...baseEnv,
    ...overrides,
  } as NodeJS.ProcessEnv;

  return import("@/modules/config/env");
};

describe("env config", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("parses a valid minimal nowpayments configuration", async () => {
    const { getEnv } = await importEnvModule();
    const env = getEnv();

    expect(env.defaultPaymentProvider).toBe("nowpayments");
    expect(env.enableMoonPay).toBe(false);
    expect(env.fx.cacheTtlSeconds).toBe(3600);
    expect(env.fx.targetCurrency).toBe("USD");
    expect(env.nowpayments.environment).toBe("sandbox");
  });

  it("supports cache reset for test-driven env overrides", async () => {
    const { getEnv, resetEnvCache } = await importEnvModule({
      DEFAULT_PAYMENT_PROVIDER: "nowpayments",
    });

    expect(getEnv().defaultPaymentProvider).toBe("nowpayments");

    process.env.DEFAULT_PAYMENT_PROVIDER = "moonpay";
    process.env.ENABLE_MOONPAY = "true";
    process.env.MOONPAY_PUBLISHABLE_KEY = "pk_test";
    process.env.MOONPAY_SECRET_KEY = "sk_test";
    process.env.MOONPAY_WEBHOOK_KEY = "wh_test";
    process.env.MOONPAY_DEFAULT_WALLET_ADDRESS = "bc1qtest";
    process.env.MOONPAY_RETURN_URL = "https://example.com/moonpay/success";
    process.env.MOONPAY_CANCEL_URL = "https://example.com/moonpay/cancel";

    resetEnvCache();

    expect(getEnv().defaultPaymentProvider).toBe("moonpay");
  });

  it("fails fast when MoonPay is enabled without required fields", async () => {
    const { getEnv } = await importEnvModule({
      ENABLE_MOONPAY: "true",
      MOONPAY_PUBLISHABLE_KEY: "pk_test",
      MOONPAY_SECRET_KEY: undefined,
    });

    expect(() => getEnv()).toThrow(/MoonPay requires/);
  });

  it("fails fast when Ramp Network is enabled without required fields", async () => {
    const { getEnv } = await importEnvModule({
      ENABLE_RAMPNETWORK: "true",
    });

    expect(() => getEnv()).toThrow(/Ramp Network requires/);
  });

  it("fails fast when stale FX ttl is shorter than cache ttl", async () => {
    const { getEnv } = await importEnvModule({
      FX_CACHE_TTL_SECONDS: "3600",
      FX_STALE_TTL_SECONDS: "120",
    });

    expect(() => getEnv()).toThrow(/FX_STALE_TTL_SECONDS/);
  });

  it("accepts the canonical shared secret name for compliance API mode", async () => {
    const { getEnv } = await importEnvModule({
      COMPLIANCE_VALIDATION_MODE: "api",
      COMPLIANCE_APP_INTERNAL_URL: "https://compliance.internal",
      PEPCLUB_INTERNAL_API_SHARED_SECRET: "shared-secret",
    });

    expect(getEnv().complianceAppSharedSecret).toBe("shared-secret");
  });
});
