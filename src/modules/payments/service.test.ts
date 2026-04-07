import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const providerMock = {
  validateConfig: vi.fn(),
  initializeSession: vi.fn(),
  processSession: vi.fn(),
  getStatus: vi.fn(),
  handleWebhook: vi.fn(),
};

const repositoryMock = {
  appendPaymentSessionEvent: vi.fn(),
  findPaymentSessionForProviderWebhook: vi.fn(),
  getOrCreateDefaultSettings: vi.fn(),
  getPaymentSessionByTransactionId: vi.fn(),
  upsertPaymentSession: vi.fn(),
};

const complianceMock = {
  assertCompliancePreconditions: vi.fn((value) => value),
  resolveComplianceContract: vi.fn(),
};

const saleorClientMock = {
  reportTransactionEvent: vi.fn(),
};

const fxServiceMock = {
  createUsdQuoteFromThbAmount: vi.fn(),
};

vi.mock("@/modules/payments/providers", () => ({
  getProvider: vi.fn(() => providerMock),
}));

vi.mock("@/modules/db/repository", () => repositoryMock);
vi.mock("@/modules/compliance/validation", () => complianceMock);
vi.mock("@/modules/saleor/client", () => saleorClientMock);
vi.mock("@/modules/fx/service", () => fxServiceMock);

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

const payload = {
  issuedAt: "2026-04-02T13:00:00.000Z",
  merchantReference: "mref_1",
  customerIpAddress: "127.0.0.1",
  idempotencyKey: "idem_1",
  data: {
    provider: "nowpayments",
  },
  action: {
    amount: 99,
    currency: "USD",
    actionType: "CHARGE",
  },
  transaction: {
    id: "tx_1",
    token: "token_1",
    pspReference: "psp_1",
  },
  sourceObject: {
    __typename: "Checkout" as const,
    id: "checkout_1",
    email: "guest@example.com",
    channel: {
      slug: "default-channel",
    },
    metadata: [],
    privateMetadata: [],
  },
};

const sessionRecord = {
  id: "session_1",
  saleorApiUrl: "https://example.saleor.cloud/graphql/",
  saleorTransactionId: "tx_1",
  saleorTransactionToken: "token_1",
  saleorPspReference: "psp_1",
  saleorMerchantReference: "mref_1",
  saleorSourceObjectType: "CHECKOUT" as const,
  saleorSourceObjectId: "checkout_1",
  checkoutId: "checkout_1",
  orderId: null,
  customerEmail: "guest@example.com",
  channelSlug: "default-channel",
  provider: "nowpayments" as const,
  providerPaymentId: "payment_1",
  providerInvoiceId: "invoice_1",
  providerReferenceId: "payment_1",
  providerStatus: "waiting",
  saleorStatus: "PENDING" as const,
  amount: "99.000000",
  currency: "USD",
  hostedUrl: "https://hosted.example",
  redirectUrl: "https://hosted.example",
  idempotencyKey: "idem_1",
  lastWebhookPayload: null,
  complianceContract: null,
  safeErrorSummary: null,
  statusReason: null,
  finalizationState: "pending" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  processedAt: null,
};

const importService = async () => {
  vi.resetModules();
  process.env = {
    ...process.env,
    ...baseEnv,
  } as NodeJS.ProcessEnv;

  return import("@/modules/payments/service");
};

describe("payment service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMock.getOrCreateDefaultSettings.mockResolvedValue({
      defaultProvider: "nowpayments",
      nowpaymentsEnabled: true,
      moonpayEnabled: false,
      rampnetworkEnabled: false,
    });
    repositoryMock.getPaymentSessionByTransactionId.mockResolvedValue(null);
    repositoryMock.upsertPaymentSession.mockResolvedValue(sessionRecord);
    repositoryMock.appendPaymentSessionEvent.mockResolvedValue({ id: "event_1" });
    complianceMock.resolveComplianceContract.mockResolvedValue({
      waiverAccepted: true,
      waiverAcceptedAt: "2026-04-02T13:00:00.000Z",
      waiverTextVersion: "pepclub-waiver-v1",
      complianceRecordId: "cmp_123",
      signatureMode: "CLICKWRAP",
    });
    providerMock.validateConfig.mockReturnValue({
      isConfigured: true,
      missingFields: [],
      summary: "configured",
    });
    fxServiceMock.createUsdQuoteFromThbAmount.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("initializes a payment session and returns an action-required sync response", async () => {
    const { initializePaymentSession } = await importService();
    providerMock.initializeSession.mockResolvedValue({
      providerStatus: "invoice_created",
      saleorStatus: "ACTION_REQUIRED",
      redirectUrl: "https://hosted.example",
      hostedUrl: "https://hosted.example",
      providerInvoiceId: "invoice_1",
      providerReferenceId: "invoice_1",
      message: "Hosted invoice created",
      rawResponse: {
        id: "invoice_1",
      },
      finalizationState: "pending",
    });

    const result = await initializePaymentSession({
      payload,
      authData: {
        saleorApiUrl: "https://example.saleor.cloud/graphql/",
        token: "token",
        appId: "app_1",
      },
      baseUrl: "http://localhost:3000",
    });

    const response = result.response as {
      result: string;
      externalUrl?: string;
    };

    expect(providerMock.initializeSession).toHaveBeenCalledOnce();
    expect(response.result).toBe("CHARGE_ACTION_REQUIRED");
    expect(response.externalUrl).toBe("https://hosted.example");
  });

  it("prefers the server FX quote over client-supplied USD metadata", async () => {
    const { initializePaymentSession } = await importService();
    const thbPayload = {
      ...payload,
      data: {
        provider: "nowpayments",
        displayCurrency: "USD",
        displayAmountUsd: 1.23,
        providerCurrency: "USD",
        providerAmount: 1.23,
        fxRate: 0.000439,
        fxProvider: "client",
        fxTimestamp: "2026-04-01T00:00:00.000Z",
        fxQuote: {
          displayCurrency: "USD",
          displayAmountUsd: 1.23,
          providerCurrency: "USD",
          providerAmount: 1.23,
          fxRate: 0.000439,
          fxProvider: "client",
          fxTimestamp: "2026-04-01T00:00:00.000Z",
        },
      },
      action: {
        ...payload.action,
        amount: 2800,
        currency: "THB",
      },
    };

    fxServiceMock.createUsdQuoteFromThbAmount.mockResolvedValue({
      sourceAmount: 2800,
      sourceCurrency: "THB",
      displayCurrency: "USD",
      displayAmountUsd: 82.4,
      providerCurrency: "USD",
      providerAmount: 82.4,
      fxRate: 0.02943,
      fxProvider: "frankfurter",
      fxTimestamp: "2026-04-07T00:00:00.000Z",
    });
    providerMock.initializeSession.mockResolvedValue({
      providerStatus: "invoice_created",
      saleorStatus: "ACTION_REQUIRED",
      redirectUrl: "https://hosted.example",
      hostedUrl: "https://hosted.example",
      providerInvoiceId: "invoice_1",
      providerReferenceId: "invoice_1",
      providerCurrency: "USD",
      providerAmount: 82.4,
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
      message: "Hosted invoice created",
      rawResponse: {
        id: "invoice_1",
      },
      finalizationState: "pending",
    });

    const result = await initializePaymentSession({
      payload: thbPayload,
      authData: {
        saleorApiUrl: "https://example.saleor.cloud/graphql/",
        token: "token",
        appId: "app_1",
      },
      baseUrl: "http://localhost:3000",
    });

    expect(fxServiceMock.createUsdQuoteFromThbAmount).toHaveBeenCalledWith(2800);
    expect(providerMock.initializeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2800,
        currency: "THB",
        providerAmount: 82.4,
        providerCurrency: "USD",
        fxQuote: expect.objectContaining({
          fxRate: 0.02943,
          providerCurrency: "USD",
        }),
      })
    );
    expect((result.response as { data?: { fxQuote?: { providerCurrency?: string } } }).data?.fxQuote)
      .toMatchObject({
        providerCurrency: "USD",
      });
  });

  it("reuses an existing THB session without refetching FX during initialize retries", async () => {
    const { initializePaymentSession } = await importService();
    const existingSession = {
      ...sessionRecord,
      amount: "2800.000000",
      currency: "THB",
    };
    const thbPayload = {
      ...payload,
      action: {
        ...payload.action,
        amount: 2800,
        currency: "THB",
      },
    };

    repositoryMock.getPaymentSessionByTransactionId.mockResolvedValue(existingSession);
    fxServiceMock.createUsdQuoteFromThbAmount.mockRejectedValue(new Error("network error"));
    providerMock.processSession.mockResolvedValue({
      providerStatus: "waiting",
      saleorStatus: "PENDING",
      redirectUrl: "https://hosted.example",
      hostedUrl: "https://hosted.example",
      providerPaymentId: "payment_1",
      providerReferenceId: "payment_1",
      message: "Still pending",
      rawResponse: {
        payment_status: "waiting",
      },
      finalizationState: "pending",
    });

    const result = await initializePaymentSession({
      payload: thbPayload,
      authData: {
        saleorApiUrl: "https://example.saleor.cloud/graphql/",
        token: "token",
        appId: "app_1",
      },
      baseUrl: "http://localhost:3000",
    });

    expect(fxServiceMock.createUsdQuoteFromThbAmount).not.toHaveBeenCalled();
    expect(providerMock.processSession).toHaveBeenCalledWith(existingSession);
    expect((result.response as { result: string }).result).toBe("CHARGE_REQUEST");
  });

  it("processes an existing session and returns a success response", async () => {
    const { processPaymentSession } = await importService();
    repositoryMock.getPaymentSessionByTransactionId.mockResolvedValue(sessionRecord);
    providerMock.processSession.mockResolvedValue({
      providerStatus: "finished",
      saleorStatus: "SUCCESS",
      redirectUrl: "https://hosted.example",
      hostedUrl: "https://hosted.example",
      providerPaymentId: "payment_1",
      providerReferenceId: "payment_1",
      message: "Payment complete",
      rawResponse: {
        payment_status: "finished",
      },
      finalizationState: "finalized",
    });

    const result = await processPaymentSession({
      payload,
      authData: {
        saleorApiUrl: "https://example.saleor.cloud/graphql/",
        token: "token",
        appId: "app_1",
      },
    });

    const response = result.response as {
      result: string;
    };

    expect(providerMock.processSession).toHaveBeenCalledWith(sessionRecord);
    expect(response.result).toBe("CHARGE_SUCCESS");
  });

  it("treats duplicate provider webhook events as idempotent", async () => {
    const { reconcileProviderWebhook } = await importService();
    providerMock.handleWebhook.mockResolvedValue({
      providerStatus: "finished",
      saleorStatus: "SUCCESS",
      providerPaymentId: "payment_1",
      providerReferenceId: "payment_1",
      message: "Payment complete",
      rawResponse: {
        payment_id: "payment_1",
        payment_status: "finished",
        order_id: "tx_1",
      },
      finalizationState: "finalized",
      externalEventId: "evt_1",
    });
    repositoryMock.findPaymentSessionForProviderWebhook.mockResolvedValue(sessionRecord);
    repositoryMock.appendPaymentSessionEvent.mockResolvedValue(null);

    const result = await reconcileProviderWebhook({
      providerKey: "nowpayments",
      rawBody: JSON.stringify({
        payment_id: "payment_1",
      }),
      payload: {},
      headers: new Headers(),
      baseUrl: "http://localhost:3000",
      authDataLoader: vi.fn(),
    });

    expect(result.saleorTransactionId).toBe("tx_1");
    expect(saleorClientMock.reportTransactionEvent).not.toHaveBeenCalled();
  });

  it("maps domain errors to safe sync failure responses", async () => {
    const { createFailureSyncResponse } = await importService();
    const { ComplianceValidationError } = await import("@/modules/core/errors");

    const response = createFailureSyncResponse(
      new ComplianceValidationError("missing waiver", "Complete the waiver first."),
      "CHARGE",
      99
    );

    const typedResponse = response as {
      result: string;
      message?: string;
    };

    expect(typedResponse.result).toBe("CHARGE_FAILURE");
    expect(typedResponse.message).toBe("Complete the waiver first.");
  });
});
