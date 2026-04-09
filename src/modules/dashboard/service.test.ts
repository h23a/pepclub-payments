import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/db/repository", () => ({
  countPaymentSessions: vi.fn(),
  countSearchPaymentSessions: vi.fn(),
  getOrCreateDefaultSettings: vi.fn(),
  getOverviewStats: vi.fn(),
  getPaymentRecapStats: vi.fn(),
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

const defaultCountryRestrictions = {
  version: 1 as const,
  mode: "allow_list" as const,
  countries: ["TH"],
  addressSource: "shipping_only" as const,
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
          countryRestrictions: defaultCountryRestrictions,
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
          countryRestrictions: defaultCountryRestrictions,
        }
      )
    ).rejects.toThrow(/fallback provider/i);
  });

  it("rejects country rules without any configured countries", async () => {
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
          nowpaymentsEnabled: true,
          moonpayEnabled: true,
          rampnetworkEnabled: false,
          countryRestrictions: {
            ...defaultCountryRestrictions,
            countries: [],
          },
        }
      )
    ).rejects.toThrow(/at least one iso country code/i);
  });
});

describe("dashboard overview recap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns payment recap metrics for the requested range", async () => {
    const repository = await import("@/modules/db/repository");
    const { checkDatabaseConnection } = await import("@/modules/db/client");
    const { getAvailableProviders } = await import("@/modules/payments/providers");
    const { getDashboardOverview } = await importDashboardService();

    vi.mocked(repository.getOrCreateDefaultSettings).mockResolvedValue({
      saleorApiUrl: "https://example.saleor.cloud/graphql/",
      defaultProvider: "moonpay",
      nowpaymentsEnabled: true,
      moonpayEnabled: true,
      rampnetworkEnabled: false,
      countryRestrictions: defaultCountryRestrictions,
      createdAt: new Date("2026-04-08T00:00:00.000Z"),
      updatedAt: new Date("2026-04-08T00:00:00.000Z"),
    });
    vi.mocked(repository.getOverviewStats).mockResolvedValue({
      transactionCount: 18,
      webhookCount: 11,
      latestWebhook: {
        providerStatus: "completed",
        createdAt: new Date("2026-04-08T10:00:00.000Z"),
      },
      latestErrorSession: {
        safeErrorSummary: "MoonPay webhook timeout",
      },
    } as never);
    vi.mocked(repository.getPaymentRecapStats).mockResolvedValue({
      rangeStart: new Date("2026-04-01T00:00:00.000Z"),
      rangeEnd: new Date("2026-04-08T00:00:00.000Z"),
      transactionCount: 8,
      successCount: 5,
      failedCount: 2,
      pendingCount: 1,
      amountsByCurrency: [
        {
          currency: "USD",
          successAmount: 1250,
          failedAmount: 140,
          pendingAmount: 85,
        },
      ],
      webhookCount: 6,
      latestWebhook: {
        providerStatus: "finished",
        createdAt: new Date("2026-04-07T10:00:00.000Z"),
      },
      latestErrorSession: {
        safeErrorSummary: "Awaiting buyer action",
      },
    } as never);
    vi.mocked(repository.getRecentPaymentSessions).mockResolvedValue([]);
    vi.mocked(checkDatabaseConnection).mockResolvedValue({ ok: true });
    vi.mocked(getAvailableProviders).mockReturnValue([
      {
        getDashboardStatus: () => ({
          provider: "moonpay",
          enabled: true,
          environment: "sandbox",
          isConfigured: true,
          summary: "ready",
          missingFields: [],
        }),
      },
    ] as never);

    const overview = await getDashboardOverview(
      {
        saleorApiUrl: "https://example.saleor.cloud/graphql/",
        token: "token",
        appId: "app_1",
      },
      { range: "7d" }
    );

    expect(repository.getPaymentRecapStats).toHaveBeenCalledWith(
      "https://example.saleor.cloud/graphql/",
      expect.objectContaining({
        from: expect.any(Date),
        to: expect.any(Date),
      })
    );
    expect(overview.paymentRecap.range).toBe("7d");
    expect(overview.paymentRecap.transactionCount).toBe(8);
    expect(overview.paymentRecap.successCount).toBe(5);
    expect(overview.paymentRecap.failedCount).toBe(2);
    expect(overview.paymentRecap.pendingCount).toBe(1);
    expect(overview.paymentRecap.amountsByCurrency).toEqual([
      {
        currency: "USD",
        successAmount: 1250,
        failedAmount: 140,
        pendingAmount: 85,
      },
    ]);
    expect(overview.paymentRecap.webhookCount).toBe(6);
    expect(overview.paymentRecap.successRate).toBeCloseTo(71.4, 1);
    expect(overview.paymentRecap.lastSafeErrorSummary).toBe("Awaiting buyer action");
    expect(overview.settings.countryRestrictions).toEqual(defaultCountryRestrictions);
  });

  it("uses custom from and to when provided", async () => {
    const repository = await import("@/modules/db/repository");
    const { checkDatabaseConnection } = await import("@/modules/db/client");
    const { getAvailableProviders } = await import("@/modules/payments/providers");
    const { getDashboardOverview } = await importDashboardService();

    vi.mocked(repository.getOrCreateDefaultSettings).mockResolvedValue({
      saleorApiUrl: "https://example.saleor.cloud/graphql/",
      defaultProvider: "nowpayments",
      nowpaymentsEnabled: true,
      moonpayEnabled: true,
      rampnetworkEnabled: false,
      countryRestrictions: defaultCountryRestrictions,
      createdAt: new Date("2026-04-08T00:00:00.000Z"),
      updatedAt: new Date("2026-04-08T00:00:00.000Z"),
    });
    vi.mocked(repository.getOverviewStats).mockResolvedValue({
      transactionCount: 0,
      webhookCount: 0,
      latestWebhook: null,
      latestErrorSession: null,
    } as never);
    vi.mocked(repository.getPaymentRecapStats).mockResolvedValue({
      rangeStart: new Date("2026-04-02T00:00:00.000Z"),
      rangeEnd: new Date("2026-04-05T23:59:59.999Z"),
      transactionCount: 3,
      successCount: 2,
      failedCount: 1,
      pendingCount: 0,
      amountsByCurrency: [],
      webhookCount: 1,
      latestWebhook: null,
      latestErrorSession: null,
    } as never);
    vi.mocked(repository.getRecentPaymentSessions).mockResolvedValue([]);
    vi.mocked(checkDatabaseConnection).mockResolvedValue({ ok: true });
    vi.mocked(getAvailableProviders).mockReturnValue([] as never);

    const overview = await getDashboardOverview(
      {
        saleorApiUrl: "https://example.saleor.cloud/graphql/",
        token: "token",
        appId: "app_1",
      },
      {
        range: "custom",
        from: "2026-04-02T00:00:00.000Z",
        to: "2026-04-05T00:00:00.000Z",
      }
    );

    expect(repository.getPaymentRecapStats).toHaveBeenCalledWith(
      "https://example.saleor.cloud/graphql/",
      {
        from: new Date("2026-04-02T00:00:00.000Z"),
        to: new Date("2026-04-05T23:59:59.999Z"),
      }
    );
    expect(overview.paymentRecap.range).toBe("custom");
  });

  it("falls back to the default recap range when the query is invalid", async () => {
    const repository = await import("@/modules/db/repository");
    const { checkDatabaseConnection } = await import("@/modules/db/client");
    const { getAvailableProviders } = await import("@/modules/payments/providers");
    const { getDashboardOverview } = await importDashboardService();

    vi.mocked(repository.getOrCreateDefaultSettings).mockResolvedValue({
      saleorApiUrl: "https://example.saleor.cloud/graphql/",
      defaultProvider: "nowpayments",
      nowpaymentsEnabled: true,
      moonpayEnabled: true,
      rampnetworkEnabled: false,
      countryRestrictions: defaultCountryRestrictions,
      createdAt: new Date("2026-04-08T00:00:00.000Z"),
      updatedAt: new Date("2026-04-08T00:00:00.000Z"),
    });
    vi.mocked(repository.getOverviewStats).mockResolvedValue({
      transactionCount: 0,
      webhookCount: 0,
      latestWebhook: null,
      latestErrorSession: null,
    } as never);
    vi.mocked(repository.getPaymentRecapStats).mockResolvedValue({
      rangeStart: new Date("2026-04-01T00:00:00.000Z"),
      rangeEnd: new Date("2026-04-08T00:00:00.000Z"),
      transactionCount: 0,
      successCount: 0,
      failedCount: 0,
      pendingCount: 0,
      amountsByCurrency: [],
      webhookCount: 0,
      latestWebhook: null,
      latestErrorSession: null,
    } as never);
    vi.mocked(repository.getRecentPaymentSessions).mockResolvedValue([]);
    vi.mocked(checkDatabaseConnection).mockResolvedValue({ ok: true });
    vi.mocked(getAvailableProviders).mockReturnValue([] as never);

    const overview = await getDashboardOverview(
      {
        saleorApiUrl: "https://example.saleor.cloud/graphql/",
        token: "token",
        appId: "app_1",
      },
      { range: "invalid-range" }
    );

    expect(overview.paymentRecap.range).toBe("7d");
  });
});

describe("lookupTransactions pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns paginated recent transactions", async () => {
    const repository = await import("@/modules/db/repository");
    const { lookupTransactions } = await importDashboardService();

    vi.mocked(repository.getRecentPaymentSessions).mockResolvedValue([
      {
        id: "sess_2",
        saleorApiUrl: "https://example.saleor.cloud/graphql/",
        saleorTransactionId: "txn_2",
      },
    ] as never);
    vi.mocked(repository.countPaymentSessions).mockResolvedValue(21);
    vi.mocked(repository.getSessionTimeline).mockResolvedValue([
      {
        id: "evt_2",
        eventType: "provider.updated",
        createdAt: new Date("2026-04-08T12:00:00.000Z"),
      },
    ] as never);

    const response = await lookupTransactions(
      {
        saleorApiUrl: "https://example.saleor.cloud/graphql/",
        token: "token",
        appId: "app_1",
      },
      { page: 2 }
    );

    expect(repository.getRecentPaymentSessions).toHaveBeenCalledWith(
      "https://example.saleor.cloud/graphql/",
      20,
      20
    );
    expect(repository.countPaymentSessions).toHaveBeenCalledWith(
      "https://example.saleor.cloud/graphql/"
    );
    expect(response.page).toBe(2);
    expect(response.pageSize).toBe(20);
    expect(response.totalCount).toBe(21);
    expect(response.hasPreviousPage).toBe(true);
    expect(response.hasNextPage).toBe(false);
    expect(response.items).toHaveLength(1);
  });

  it("returns paginated search transactions", async () => {
    const repository = await import("@/modules/db/repository");
    const { lookupTransactions } = await importDashboardService();

    vi.mocked(repository.searchPaymentSessions).mockResolvedValue([
      {
        id: "sess_search",
        saleorApiUrl: "https://example.saleor.cloud/graphql/",
        saleorTransactionId: "txn_search",
      },
    ] as never);
    vi.mocked(repository.countSearchPaymentSessions).mockResolvedValue(45);
    vi.mocked(repository.getSessionTimeline).mockResolvedValue([] as never);

    const response = await lookupTransactions(
      {
        saleorApiUrl: "https://example.saleor.cloud/graphql/",
        token: "token",
        appId: "app_1",
      },
      { search: "txn", page: 1 }
    );

    expect(repository.searchPaymentSessions).toHaveBeenCalledWith(
      "https://example.saleor.cloud/graphql/",
      "txn",
      {
        limit: 20,
        offset: 0,
      }
    );
    expect(repository.countSearchPaymentSessions).toHaveBeenCalledWith(
      "https://example.saleor.cloud/graphql/",
      "txn"
    );
    expect(response.page).toBe(1);
    expect(response.hasPreviousPage).toBe(false);
    expect(response.hasNextPage).toBe(true);
    expect(response.totalCount).toBe(45);
  });
});
