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
  FRANKFURTER_API_URL: "https://api.frankfurter.dev/v1/latest",
  FX_CACHE_TTL_SECONDS: "3600",
  FX_STALE_TTL_SECONDS: "86400",
  FX_SOURCE_CURRENCY: "THB",
  FX_TARGET_CURRENCY: "USD",
  PAYMENT_SUCCESS_URL: "https://example.com/success",
  PAYMENT_CANCEL_URL: "https://example.com/cancel",
  PAYMENT_STATUS_URL: "https://example.com/status",
};

const importFxModule = async (overrides: Record<string, string | undefined> = {}) => {
  vi.resetModules();
  process.env = {
    ...process.env,
    ...baseEnv,
    ...overrides,
  } as NodeJS.ProcessEnv;

  return import("@/modules/fx/service");
};

describe("fx service", () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.resetModules();
    const { resetFxRateCache } = await importFxModule();
    resetFxRateCache();
  });

  it("fetches and converts THB to USD", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        date: "2026-04-07",
        rates: {
          USD: 0.02943,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createUsdQuoteFromThbAmount } = await importFxModule();
    const quote = await createUsdQuoteFromThbAmount(2800);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(quote.providerCurrency).toBe("USD");
    expect(quote.displayAmountUsd).toBe(82.4);
    expect(quote.fxRate).toBe(0.02943);
  });

  it("reuses the cached rate while ttl is active", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        date: "2026-04-07",
        rates: {
          USD: 0.03,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createUsdQuoteFromThbAmount } = await importFxModule();

    await createUsdQuoteFromThbAmount(100);
    await createUsdQuoteFromThbAmount(200);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("falls back to stale cache when a refresh fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          date: "2026-04-07",
          rates: {
            USD: 0.03,
          },
        }),
      })
      .mockRejectedValueOnce(new Error("network error"));
    vi.stubGlobal("fetch", fetchMock);

    const { createUsdQuoteFromThbAmount } = await importFxModule({
      FX_CACHE_TTL_SECONDS: "1",
      FX_STALE_TTL_SECONDS: "10",
    });

    await createUsdQuoteFromThbAmount(100);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const secondQuote = await createUsdQuoteFromThbAmount(200);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(secondQuote.fxRate).toBe(0.03);
  });
});
