import { describe, expect, it } from "vitest";

import { resolveProviderKey } from "@/modules/payments/provider-resolver";

describe("resolveProviderKey", () => {
  const settings = {
    defaultProvider: "nowpayments",
    nowpaymentsEnabled: true,
    moonpayEnabled: true,
    rampnetworkEnabled: true,
  };

  it("prefers an explicit provider from paymentGateway.data", () => {
    const provider = resolveProviderKey({ provider: "moonpay" }, settings);

    expect(provider).toBe("moonpay");
  });

  it("falls back to the configured fallback provider", () => {
    const provider = resolveProviderKey({}, settings);

    expect(provider).toBe("nowpayments");
  });

  it("rejects disabled providers", () => {
    expect(() =>
      resolveProviderKey(
        { provider: "moonpay" },
        {
          ...settings,
          moonpayEnabled: false,
        }
      )
    ).toThrow(/disabled/);
  });

  it("supports Ramp Network as explicit provider", () => {
    const provider = resolveProviderKey({ provider: "rampnetwork" }, settings);

    expect(provider).toBe("rampnetwork");
  });
});
