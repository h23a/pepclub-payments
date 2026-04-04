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
  DEFAULT_PAYMENT_PROVIDER: "rampnetwork",
  ENABLE_NOWPAYMENTS: "false",
  ENABLE_MOONPAY: "false",
  ENABLE_RAMPNETWORK: "true",
  COMPLIANCE_VALIDATION_MODE: "metadata",
  REQUIRE_SIGNATURE_COMPLETION: "false",
  RAMPNETWORK_API_KEY: "ramp_key",
  RAMPNETWORK_WEBHOOK_SECRET: "ramp_secret_unused_for_public_key_mode",
  RAMPNETWORK_ENV: "sandbox",
  RAMPNETWORK_HOST_APP_NAME: "Pepclub",
  RAMPNETWORK_HOST_LOGO_URL: "https://example.com/logo.png",
  RAMPNETWORK_DEFAULT_ASSET: "ETH",
  RAMPNETWORK_DEFAULT_FIAT_CURRENCY: "USD",
  RAMPNETWORK_DEFAULT_FIAT_VALUE: "100",
  RAMPNETWORK_DEFAULT_USER_ADDRESS: "0xdefault",
  RAMPNETWORK_FINAL_URL: "https://example.com/final",
  PAYMENT_SUCCESS_URL: "https://example.com/success",
  PAYMENT_CANCEL_URL: "https://example.com/cancel",
  PAYMENT_STATUS_URL: "https://example.com/status",
};

const importRampModule = async () => {
  vi.resetModules();
  process.env = {
    ...process.env,
    ...baseEnv,
  } as NodeJS.ProcessEnv;

  return import("@/modules/payments/providers/rampnetwork");
};

describe("Ramp Network provider", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("builds hosted URLs with wallet precedence and core params", async () => {
    const { buildRampHostedUrl } = await importRampModule();

    const url = buildRampHostedUrl({
      saleorApiUrl: "https://example.saleor.cloud/graphql/",
      amount: 100,
      currency: "USD",
      merchantReference: "mref_1",
      transactionId: "tx_1",
      idempotencyKey: "idem_1",
      customerEmail: "guest@example.com",
      customerIpAddress: "127.0.0.1",
      baseUrl: "http://localhost:3000",
      gatewayData: {
        walletAddress: "0xpreferred",
        asset: "MATIC",
        fiatCurrency: "EUR",
        fiatValue: "200",
      },
      sourceObjectId: "checkout_1",
      sourceObjectType: "CHECKOUT",
    });

    expect(url).toContain("hostApiKey=ramp_key");
    expect(url).toContain("userAddress=0xpreferred");
    expect(url).toContain("swapAsset=MATIC");
    expect(url).toContain("fiatCurrency=EUR");
    expect(url).toContain("fiatValue=200");
    expect(url).toContain("webhookStatusUrl=");
  });

  it("maps purchase status and performs API lookup", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        purchase: {
          id: "purchase_1",
          purchaseViewToken: "view_1",
          status: "RELEASED",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { RampNetworkProvider } = await importRampModule();
    const provider = new RampNetworkProvider();
    const result = await provider.getStatus({
      id: "session_1",
      saleorApiUrl: "https://example.saleor.cloud/graphql/",
      saleorTransactionId: "tx_1",
      saleorMerchantReference: "mref_1",
      saleorSourceObjectType: "CHECKOUT",
      saleorSourceObjectId: "checkout_1",
      provider: "rampnetwork",
      providerPaymentId: "purchase_1",
      providerReferenceId: "view_1",
      providerStatus: "INITIALIZED",
      saleorStatus: "ACTION_REQUIRED",
      amount: "100.000000",
      currency: "USD",
      idempotencyKey: "idem_1",
      finalizationState: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.saleorStatus).toBe("SUCCESS");
    expect(result.providerPaymentId).toBe("purchase_1");
  });
});
