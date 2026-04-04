import { describe, expect, it } from "vitest";

import {
  getFinalizationState,
  mapMoonPayStatus,
  mapNowPaymentsStatus,
  mapSaleorStatusToSyncResult,
} from "@/modules/payments/status-mapping";

describe("payment status mapping", () => {
  it("maps NOWPayments statuses", () => {
    expect(mapNowPaymentsStatus("finished")).toBe("SUCCESS");
    expect(mapNowPaymentsStatus("confirming")).toBe("PENDING");
    expect(mapNowPaymentsStatus("expired")).toBe("EXPIRED");
    expect(mapNowPaymentsStatus("failed")).toBe("FAILED");
  });

  it("maps MoonPay statuses", () => {
    expect(mapMoonPayStatus("completed")).toBe("SUCCESS");
    expect(mapMoonPayStatus("pending")).toBe("PENDING");
    expect(mapMoonPayStatus("aml_rejected")).toBe("FAILED");
    expect(mapMoonPayStatus("canceled")).toBe("CANCELLED");
  });

  it("maps Saleor statuses to sync webhook results", () => {
    expect(mapSaleorStatusToSyncResult("ACTION_REQUIRED", "CHARGE")).toBe("CHARGE_ACTION_REQUIRED");
    expect(mapSaleorStatusToSyncResult("SUCCESS", "CHARGE")).toBe("CHARGE_SUCCESS");
    expect(mapSaleorStatusToSyncResult("AUTHORIZED", "AUTHORIZATION")).toBe("AUTHORIZATION_SUCCESS");
    expect(mapSaleorStatusToSyncResult("FAILED", "AUTHORIZATION")).toBe("AUTHORIZATION_FAILURE");
  });

  it("marks terminal statuses as finalized", () => {
    expect(getFinalizationState("SUCCESS")).toBe("finalized");
    expect(getFinalizationState("FAILED")).toBe("finalized");
    expect(getFinalizationState("PENDING")).toBe("pending");
  });
});
