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
  DEFAULT_PAYMENT_PROVIDER: "nowpayments",
  ENABLE_NOWPAYMENTS: "true",
  ENABLE_MOONPAY: "false",
  ENABLE_RAMPNETWORK: "false",
  COMPLIANCE_VALIDATION_MODE: "metadata",
  REQUIRE_SIGNATURE_COMPLETION: "false",
  NOWPAYMENTS_API_KEY: "np_key",
  NOWPAYMENTS_IPN_SECRET: "np_secret",
  NOWPAYMENTS_ENV: "sandbox",
  PAYMENT_SUCCESS_URL: "https://example.com/success",
  PAYMENT_CANCEL_URL: "https://example.com/cancel",
  PAYMENT_STATUS_URL: "https://example.com/status",
};

const importNowPaymentsModule = async () => {
  vi.resetModules();
  process.env = {
    ...process.env,
    ...baseEnv,
  } as NodeJS.ProcessEnv;

  return import("@/modules/payments/providers/nowpayments");
};

describe("NOWPayments provider", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("verifies NOWPayments signatures using sorted payload keys", async () => {
    const { verifyNowPaymentsSignature } = await importNowPaymentsModule();
    const payload = {
      z: "last",
      a: {
        y: "nested",
        x: "value",
      },
    };
    const signature = crypto
      .createHmac("sha512", "np_secret")
      .update(JSON.stringify({ a: { x: "value", y: "nested" }, z: "last" }))
      .digest("hex");

    expect(verifyNowPaymentsSignature(payload, signature, "np_secret")).toBe(true);
  });

  it("maps a valid webhook into a finalized success state", async () => {
    const { NowPaymentsProvider, verifyNowPaymentsSignature } = await importNowPaymentsModule();
    const provider = new NowPaymentsProvider();
    const payload = {
      payment_id: 123,
      invoice_id: 456,
      payment_status: "finished",
      order_id: "tx_1",
    };
    const signature = crypto
      .createHmac("sha512", "np_secret")
      .update(
        JSON.stringify({
          invoice_id: 456,
          order_id: "tx_1",
          payment_id: 123,
          payment_status: "finished",
        })
      )
      .digest("hex");

    expect(verifyNowPaymentsSignature(payload, signature, "np_secret")).toBe(true);

    const result = await provider.handleWebhook({
      headers: new Headers({
        "x-nowpayments-sig": signature,
      }),
      rawBody: JSON.stringify(payload),
      payload,
    });

    expect(result.saleorStatus).toBe("SUCCESS");
    expect(result.providerPaymentId).toBe("123");
    expect(result.externalEventId).toContain("finished");
  });

  it("uses USD provider quote when present during initialize", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "invoice_1",
        invoice_url: "https://nowpayments.example/invoice_1",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { NowPaymentsProvider } = await importNowPaymentsModule();
    const provider = new NowPaymentsProvider();
    const result = await provider.initializeSession({
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
      fxQuote: {
        sourceAmount: 2800,
        sourceCurrency: "THB",
        displayCurrency: "USD",
        displayAmountUsd: 82.4,
        providerCurrency: "USD",
        providerAmount: 82.4,
        fxRate: 0.02943,
        fxProvider: "frankfurter",
        fxTimestamp: "2026-04-07T00:00:00.000Z",
      },
      gatewayData: {
        quoteCurrency: "btc",
      },
      sourceObjectId: "checkout_1",
      sourceObjectType: "CHECKOUT",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      price_amount: 82.4,
      price_currency: "usd",
      pay_currency: "btc",
    });
    expect(result.providerCurrency).toBe("USD");
    expect(result.providerAmount).toBe(82.4);
  });
});
