import { describe, expect, it } from "vitest";

import { ValidationError } from "@/modules/core/errors";
import {
  parseDashboardOverviewQuery,
  parseDashboardSettingsBody,
  parseDashboardTransactionsQuery,
  parseMoonPaySignUrlBody,
  parseReconcileRequestBody,
} from "@/modules/dashboard/validation";

describe("dashboard validation", () => {
  it("parses dashboard settings payloads into typed settings", () => {
    const payload = parseDashboardSettingsBody({
      defaultProvider: "moonpay",
      nowpaymentsEnabled: true,
      moonpayEnabled: true,
      rampnetworkEnabled: false,
      countryRestrictions: {
        mode: "allow_list",
        countries: ["th", "SG", "bad"],
      },
    });

    expect(payload).toEqual({
      defaultProvider: "moonpay",
      nowpaymentsEnabled: true,
      moonpayEnabled: true,
      rampnetworkEnabled: false,
      countryRestrictions: {
        version: 1,
        mode: "allow_list",
        countries: ["TH", "SG"],
        addressSource: "shipping_only",
      },
    });
  });

  it("rejects missing reconcile identifiers", () => {
    expect(() => parseReconcileRequestBody({ saleorTransactionId: " " })).toThrow(ValidationError);
  });

  it("accepts overview aliases used by older clients", () => {
    expect(parseDashboardOverviewQuery({ range: "24h" }).range).toBe("24h");
    expect(parseDashboardOverviewQuery({ range: "30d" }).range).toBe("30d");
  });

  it("normalizes transaction query pagination", () => {
    expect(parseDashboardTransactionsQuery({ search: " txn_1 ", page: "2" })).toEqual({
      search: "txn_1",
      page: 2,
    });
  });

  it("parses MoonPay signing payloads with coerced amounts", () => {
    expect(
      parseMoonPaySignUrlBody({
        amount: "125.50",
        currency: "USD",
      })
    ).toEqual({
      amount: 125.5,
      currency: "USD",
    });
  });
});
