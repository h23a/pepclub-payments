import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/db/repository", () => ({
  getOrCreateDefaultSettings: vi.fn(),
  getOverviewStats: vi.fn(),
  getPaymentSessionByTransactionId: vi.fn(),
  getRecentPaymentSessions: vi.fn(),
  getSessionTimeline: vi.fn(),
  searchPaymentSessions: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("@/modules/db/client", () => ({
  checkDatabaseConnection: vi.fn(),
}));

vi.mock("@/modules/payments/providers", () => ({
  getAvailableProviders: vi.fn(() => []),
}));

vi.mock("@/modules/payments/service", () => ({
  manuallyReconcilePaymentSession: vi.fn(),
}));

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
  ENABLE_MOONPAY: "true",
  ENABLE_RAMPNETWORK: "false",
  COMPLIANCE_VALIDATION_MODE: "metadata",
  REQUIRE_SIGNATURE_COMPLETION: "false",
  NOWPAYMENTS_API_KEY: "np_key",
  NOWPAYMENTS_IPN_SECRET: "np_secret",
  NOWPAYMENTS_ENV: "sandbox",
  MOONPAY_PUBLISHABLE_KEY: "pk_test",
  MOONPAY_SECRET_KEY: "sk_test",
  MOONPAY_WEBHOOK_KEY: "wh_test",
  MOONPAY_ENV: "sandbox",
  MOONPAY_DEFAULT_BASE_CURRENCY: "usd",
  MOONPAY_DEFAULT_QUOTE_CURRENCY: "btc",
  MOONPAY_DEFAULT_WALLET_ADDRESS: "bc1qexample",
  MOONPAY_RETURN_URL: "https://example.com/return",
  MOONPAY_CANCEL_URL: "https://example.com/cancel",
  PAYMENT_SUCCESS_URL: "https://example.com/success",
  PAYMENT_CANCEL_URL: "https://example.com/cancel",
  PAYMENT_STATUS_URL: "https://example.com/status",
};

const importDashboardService = async () => {
  vi.resetModules();
  process.env = {
    ...process.env,
    ...baseEnv,
  } as NodeJS.ProcessEnv;

  return import("@/modules/dashboard/service");
};

describe("dashboard settings validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects disabling all providers", async () => {
    const { saveDashboardSettings } = await importDashboardService();

    await expect(
      saveDashboardSettings(
        {
          saleorApiUrl: "https://example.saleor.cloud/graphql/",
          token: "token",
          appId: "app_1",
        },
        {
          defaultProvider: "nowpayments",
          nowpaymentsEnabled: false,
          moonpayEnabled: false,
          rampnetworkEnabled: false,
        }
      )
    ).rejects.toThrow(/payment provider must remain enabled/i);
  });

  it("rejects disabled fallback providers", async () => {
    const { saveDashboardSettings } = await importDashboardService();

    await expect(
      saveDashboardSettings(
        {
          saleorApiUrl: "https://example.saleor.cloud/graphql/",
          token: "token",
          appId: "app_1",
        },
        {
          defaultProvider: "moonpay",
          nowpaymentsEnabled: true,
          moonpayEnabled: false,
          rampnetworkEnabled: true,
        }
      )
    ).rejects.toThrow(/fallback provider/i);
  });
});
