import crypto from "crypto";
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
  DEFAULT_PAYMENT_PROVIDER: "moonpay",
  ENABLE_NOWPAYMENTS: "false",
  ENABLE_MOONPAY: "true",
  ENABLE_RAMPNETWORK: "false",
  COMPLIANCE_VALIDATION_MODE: "metadata",
  REQUIRE_SIGNATURE_COMPLETION: "false",
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

const importMoonPayModule = async () => {
  vi.resetModules();
  process.env = {
    ...process.env,
    ...baseEnv,
  } as NodeJS.ProcessEnv;

  return import("@/modules/payments/providers/moonpay");
};

describe("MoonPay provider", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("generates a signed widget URL", async () => {
    const { buildSignedMoonPayUrl } = await importMoonPayModule();

    const url = buildSignedMoonPayUrl({
      saleorApiUrl: "https://example.saleor.cloud/graphql/",
      amount: 2800,
      currency: "THB",
      merchantReference: "mref_1",
      transactionId: "tx_1",
      idempotencyKey: "idem_1",
      customerEmail: "guest@example.com",
      customerIpAddress: "127.0.0.1",
      baseUrl: "http://localhost:3000",
      providerAmount: 82.4,
      providerCurrency: "USD",
      gatewayData: {
        walletAddress: "bc1qcustom",
      },
      sourceObjectId: "checkout_1",
      sourceObjectType: "CHECKOUT",
    });

    expect(url).toContain("signature=");
    expect(url).toContain("externalTransactionId=tx_1");
    expect(url).toContain("walletAddress=bc1qcustom");
    expect(url).toContain("baseCurrencyCode=usd");
    expect(url).toContain("baseCurrencyAmount=82.40");
  });

  it("verifies MoonPay webhook signatures", async () => {
    const { verifyMoonPayWebhookSignature } = await importMoonPayModule();
    const timestamp = "1712059977";
    const rawBody = JSON.stringify({
      type: "transaction_updated",
      data: {
        id: "moon_tx_1",
        externalTransactionId: "tx_1",
        status: "completed",
      },
    });
    const signature = crypto
      .createHmac("sha256", "wh_test")
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");

    expect(
      verifyMoonPayWebhookSignature(rawBody, `t=${timestamp},s=${signature}`, "wh_test")
    ).toBe(true);
  });
});
