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

const checkoutSourceObject = {
  __typename: "Checkout" as const,
  id: "checkout_1",
  email: "guest@example.com",
  channel: {
    slug: "default-channel",
  },
  metadata: [
    {
      key: "pepclub_compliance",
      value: JSON.stringify({
        waiverAccepted: true,
        waiverAcceptedAt: "2026-04-02T13:00:00.000Z",
        waiverTextVersion: "pepclub-waiver-v1",
        complianceRecordId: "cmp_123",
        signatureMode: "CLICKWRAP",
      }),
    },
  ],
  privateMetadata: [],
};

const scalarMetadataSourceObject = {
  ...checkoutSourceObject,
  metadata: [],
  privateMetadata: [
    { key: "pepclubComplianceRecordId", value: "cmp_scalar" },
    { key: "pepclubComplianceWaiverAccepted", value: "true" },
    { key: "pepclubComplianceWaiverAcceptedAt", value: "2026-04-02T13:00:00.000Z" },
    { key: "pepclubComplianceWaiverTextVersion", value: "pepclub-waiver-v2" },
    { key: "pepclubComplianceWaiverStatus", value: "CLICKWRAP_ACCEPTED" },
    { key: "pepclubComplianceSignatureMode", value: "CLICKWRAP" },
    { key: "pepclubComplianceSignatureCompleted", value: "true" },
    { key: "pepclubCompliancePaymentAllowed", value: "true" },
  ],
};

const importComplianceModule = async (overrides: Record<string, string> = {}) => {
  vi.resetModules();
  process.env = {
    ...process.env,
    ...baseEnv,
    ...overrides,
  } as NodeJS.ProcessEnv;

  return import("@/modules/compliance/validation");
};

describe("compliance validation", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("resolves a compliance contract from metadata in metadata mode", async () => {
    const { resolveComplianceContract } = await importComplianceModule();

    const contract = await resolveComplianceContract({
      sourceObject: checkoutSourceObject,
      saleorApiUrl: "https://example.saleor.cloud/graphql/",
      merchantReference: "mref_1",
      gatewayDataContract: undefined,
    });

    expect(contract.complianceRecordId).toBe("cmp_123");
    expect(contract.waiverAccepted).toBe(true);
  });

  it("requires signature completion in strict mode", async () => {
    const { resolveComplianceContract } = await importComplianceModule({
      REQUIRE_SIGNATURE_COMPLETION: "true",
    });

    await expect(
      resolveComplianceContract({
        sourceObject: {
          ...checkoutSourceObject,
          metadata: [
            {
              key: "pepclub_compliance",
              value: JSON.stringify({
                waiverAccepted: true,
                waiverAcceptedAt: "2026-04-02T13:00:00.000Z",
                waiverTextVersion: "pepclub-waiver-v1",
                complianceRecordId: "cmp_123",
                signatureMode: "CLICKWRAP",
                signatureCompleted: false,
              }),
            },
          ],
        },
        saleorApiUrl: "https://example.saleor.cloud/graphql/",
        merchantReference: "mref_1",
        gatewayDataContract: undefined,
      })
    ).rejects.toThrow(/signatureCompleted/);
  });

  it("resolves scalar compliance metadata written by pepclub-compliance", async () => {
    const { resolveComplianceContract } = await importComplianceModule();

    const contract = await resolveComplianceContract({
      sourceObject: scalarMetadataSourceObject,
      saleorApiUrl: "https://example.saleor.cloud/graphql/",
      merchantReference: "mref_scalar",
      gatewayDataContract: undefined,
    });

    expect(contract.complianceRecordId).toBe("cmp_scalar");
    expect(contract.waiverTextVersion).toBe("pepclub-waiver-v2");
    expect(contract.signatureCompleted).toBe(true);
    expect(contract.isPaymentAllowed).toBe(true);
  });

  it("uses the internal compliance API in api mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        waiverAccepted: true,
        waiverAcceptedAt: "2026-04-02T13:00:00.000Z",
        waiverTextVersion: "pepclub-waiver-v1",
        complianceRecordId: "cmp_api",
        signatureMode: "CLICKWRAP",
        signatureCompleted: true,
        isPaymentAllowed: true,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { resolveComplianceContract } = await importComplianceModule({
      COMPLIANCE_VALIDATION_MODE: "api",
      COMPLIANCE_APP_INTERNAL_URL: "https://compliance.internal",
      COMPLIANCE_APP_SHARED_SECRET: "shared_secret",
    });

    const contract = await resolveComplianceContract({
      sourceObject: checkoutSourceObject,
      saleorApiUrl: "https://example.saleor.cloud/graphql/",
      merchantReference: "mref_1",
      gatewayDataContract: undefined,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://compliance.internal/api/internal/compliance/status",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-pepclub-shared-secret": "shared_secret",
        }),
      })
    );
    expect(contract.complianceRecordId).toBe("cmp_api");
  });

  it("blocks payment when compliance policy says payment is not allowed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        waiverAccepted: true,
        waiverAcceptedAt: "2026-04-02T13:00:00.000Z",
        waiverTextVersion: "pepclub-waiver-v1",
        complianceRecordId: "cmp_blocked",
        signatureMode: "ZOHO_SIGN",
        signatureCompleted: false,
        isPaymentAllowed: false,
        reason: "A formal signature is required before payment.",
        adminReason: "Zoho Sign must be completed before payment can proceed.",
        nextAction: "START_ZOHO_SIGNING",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { resolveComplianceContract } = await importComplianceModule({
      COMPLIANCE_VALIDATION_MODE: "api",
      COMPLIANCE_APP_INTERNAL_URL: "https://compliance.internal",
      COMPLIANCE_APP_SHARED_SECRET: "shared_secret",
    });

    await expect(
      resolveComplianceContract({
        sourceObject: checkoutSourceObject,
        saleorApiUrl: "https://example.saleor.cloud/graphql/",
        merchantReference: "mref_blocked",
        gatewayDataContract: undefined,
      })
    ).rejects.toThrow(/Zoho Sign|formal signature is required before payment/i);
  });
});
