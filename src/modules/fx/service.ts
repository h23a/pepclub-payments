import { getEnv } from "@/modules/config/env";
import { UsdQuoteMetadata } from "@/modules/payments/types";

type FrankfurterRatesResponse = {
  amount?: number;
  base?: string;
  date?: string;
  rates?: Record<string, number>;
};

type FxRateCacheEntry = {
  cachedAtMs: number;
  fxProvider: string;
  fxTimestamp: string;
  rate: number;
  sourceCurrency: string;
  staleUntilMs: number;
  targetCurrency: string;
};

let fxRateCache: FxRateCacheEntry | null = null;

const roundMoney = (amount: number) => Number(amount.toFixed(2));
const roundRate = (rate: number) => Number(rate.toFixed(6));

const buildFxTimestamp = (date: string | undefined) =>
  date ? new Date(`${date}T00:00:00.000Z`).toISOString() : new Date().toISOString();

const fetchFxRate = async () => {
  const env = getEnv();
  const url = new URL(env.fx.apiUrl);
  url.searchParams.set("base", env.fx.sourceCurrency);
  url.searchParams.set("symbols", env.fx.targetCurrency);

  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
    },
  });

  const payload = (await response.json()) as FrankfurterRatesResponse;

  if (!response.ok) {
    throw new Error(`Frankfurter request failed with status ${response.status}.`);
  }

  const rawRate = payload.rates?.[env.fx.targetCurrency];

  if (typeof rawRate !== "number" || !Number.isFinite(rawRate) || rawRate <= 0) {
    throw new Error("Frankfurter response did not include a valid FX rate.");
  }

  return {
    cachedAtMs: Date.now(),
    fxProvider: env.fx.providerName,
    fxTimestamp: buildFxTimestamp(payload.date),
    rate: rawRate,
    sourceCurrency: env.fx.sourceCurrency,
    staleUntilMs: Date.now() + env.fx.staleTtlSeconds * 1000,
    targetCurrency: env.fx.targetCurrency,
  } satisfies FxRateCacheEntry;
};

export const getCachedFxRate = async () => {
  const env = getEnv();

  if (fxRateCache && Date.now() - fxRateCache.cachedAtMs <= env.fx.cacheTtlSeconds * 1000) {
    return fxRateCache;
  }

  try {
    const nextValue = await fetchFxRate();
    fxRateCache = nextValue;
    return nextValue;
  } catch (error) {
    if (fxRateCache && Date.now() <= fxRateCache.staleUntilMs) {
      return fxRateCache;
    }

    throw error;
  }
};

export const createUsdQuoteFromThbAmount = async (sourceAmount: number): Promise<UsdQuoteMetadata> => {
  const rate = await getCachedFxRate();
  const providerAmount = roundMoney(sourceAmount * rate.rate);

  return {
    displayAmountUsd: providerAmount,
    displayCurrency: rate.targetCurrency,
    fxProvider: rate.fxProvider,
    fxRate: roundRate(rate.rate),
    fxTimestamp: rate.fxTimestamp,
    providerAmount,
    providerCurrency: rate.targetCurrency,
    sourceAmount: roundMoney(sourceAmount),
    sourceCurrency: rate.sourceCurrency,
  };
};

export const resetFxRateCache = () => {
  fxRateCache = null;
};
