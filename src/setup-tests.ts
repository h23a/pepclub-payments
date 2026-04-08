import "@testing-library/jest-dom/vitest";

import { afterEach, beforeEach, vi } from "vitest";

import { resetEnvCache } from "@/modules/config/env";

const baseEnv = {
  APP_API_BASE_URL: "http://localhost:3000",
  APP_IFRAME_BASE_URL: "http://localhost:3000",
  APP_URL: "http://localhost:3000",
  APL: "file",
  COMPLIANCE_VALIDATION_MODE: "metadata",
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/pepclub_payments",
  DEFAULT_PAYMENT_PROVIDER: "nowpayments",
  ENABLE_MOONPAY: "false",
  ENABLE_NOWPAYMENTS: "true",
  ENABLE_RAMPNETWORK: "false",
  LOG_LEVEL: "info",
  NODE_ENV: "test",
  NOWPAYMENTS_API_KEY: "np_key",
  NOWPAYMENTS_IPN_SECRET: "np_secret",
  NOWPAYMENTS_ENV: "sandbox",
  PEPCLUB_INTERNAL_API_SHARED_SECRET: "test-shared-secret",
  PAYMENT_CANCEL_URL: "https://example.com/cancel",
  PAYMENT_STATUS_URL: "https://example.com/status",
  PAYMENT_SUCCESS_URL: "https://example.com/success",
  REQUIRE_SIGNATURE_COMPLETION: "false",
  SALEOR_API_URL: "https://saleor.example/graphql/",
};

beforeEach(() => {
  Object.assign(process.env, baseEnv);
  resetEnvCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetEnvCache();
});
