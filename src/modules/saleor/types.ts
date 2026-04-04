import { ComplianceContract, PaymentGatewayData, SaleorActionType } from "@/modules/payments/types";
import { safeJsonParse } from "@/modules/utils/object";

export type MetadataItem = {
  key: string;
  value: string;
};

type CheckoutSourceObject = {
  __typename: "Checkout";
  id: string;
  email?: string | null;
  channel: {
    slug: string;
  };
  metadata: MetadataItem[];
  privateMetadata: MetadataItem[];
};

type OrderSourceObject = {
  __typename: "Order";
  id: string;
  checkoutId?: string | null;
  userEmail?: string | null;
  channel: {
    slug: string;
  };
  metadata: MetadataItem[];
  privateMetadata: MetadataItem[];
};

export type SaleorSourceObject = CheckoutSourceObject | OrderSourceObject;

export type SaleorTransactionSessionPayload = {
  issuedAt?: string | null;
  version?: string | null;
  merchantReference: string;
  customerIpAddress?: string | null;
  data?: unknown;
  action: {
    amount: number;
    currency: string;
    actionType: string;
  };
  transaction: {
    id: string;
    token?: string | null;
    pspReference?: string | null;
    externalUrl?: string | null;
  };
  sourceObject: SaleorSourceObject;
  idempotencyKey?: string | null;
};

const metadataToRecord = (items: MetadataItem[]) =>
  items.reduce<Record<string, string>>((acc, item) => {
    acc[item.key] = item.value;
    return acc;
  }, {});

const parseMetadataBoolean = (value: string | undefined) => {
  if (value === undefined || value === "") {
    return undefined;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return undefined;
};

export const extractComplianceValue = (sourceObject: SaleorSourceObject): Partial<ComplianceContract> | null => {
  const merged = {
    ...metadataToRecord(sourceObject.metadata),
    ...metadataToRecord(sourceObject.privateMetadata),
  };

  const metadataKeys = [
    "pepclub_compliance",
    "compliance_contract",
    "waiver_contract",
    "waiverCompliance",
  ];

  let jsonContract: Partial<ComplianceContract> | null = null;

  for (const key of metadataKeys) {
    if (merged[key]) {
      const parsed = safeJsonParse<Partial<ComplianceContract>>(merged[key], {});
      if (parsed && Object.keys(parsed).length > 0) {
        jsonContract = parsed;
        break;
      }
    }
  }

  const scalarContract: Partial<ComplianceContract> = {
    complianceRecordId: merged.pepclubComplianceRecordId || undefined,
    waiverAccepted: parseMetadataBoolean(merged.pepclubComplianceWaiverAccepted),
    waiverAcceptedAt: merged.pepclubComplianceWaiverAcceptedAt || undefined,
    waiverTextVersion: merged.pepclubComplianceWaiverTextVersion || undefined,
    waiverStatus: merged.pepclubComplianceWaiverStatus || undefined,
    signatureMode:
      merged.pepclubComplianceSignatureMode === "CLICKWRAP" ||
      merged.pepclubComplianceSignatureMode === "ZOHO_SIGN"
        ? merged.pepclubComplianceSignatureMode
        : undefined,
    signatureCompleted: parseMetadataBoolean(merged.pepclubComplianceSignatureCompleted),
    isPaymentAllowed: parseMetadataBoolean(merged.pepclubCompliancePaymentAllowed),
    typedFullName: merged.pepclubComplianceTypedFullName || undefined,
  };

  const hasScalarContract = Object.values(scalarContract).some((value) => value !== undefined);

  if (!jsonContract && !hasScalarContract) {
    return null;
  }

  return {
    ...(jsonContract ?? {}),
    ...(hasScalarContract ? scalarContract : {}),
  };
};

export const getSourceObjectIdentifiers = (sourceObject: SaleorSourceObject) => {
  if (sourceObject.__typename === "Checkout") {
    return {
      sourceObjectType: "CHECKOUT" as const,
      sourceObjectId: sourceObject.id,
      checkoutId: sourceObject.id,
      orderId: null,
      customerEmail: sourceObject.email ?? null,
      channelSlug: sourceObject.channel.slug,
    };
  }

  return {
    sourceObjectType: "ORDER" as const,
    sourceObjectId: sourceObject.id,
    checkoutId: sourceObject.checkoutId ?? null,
    orderId: sourceObject.id,
    customerEmail: sourceObject.userEmail ?? null,
    channelSlug: sourceObject.channel.slug,
  };
};

export const getPaymentGatewayData = (payload: SaleorTransactionSessionPayload): PaymentGatewayData => {
  const data = payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : {};
  const compliance = extractComplianceValue(payload.sourceObject);

  return {
    provider:
      typeof data.provider === "string"
        ? data.provider
        : typeof data.paymentProvider === "string"
          ? data.paymentProvider
          : typeof data.gateway === "string"
            ? data.gateway
            : undefined,
    paymentProvider: typeof data.paymentProvider === "string" ? data.paymentProvider : undefined,
    gateway: typeof data.gateway === "string" ? data.gateway : undefined,
    walletAddress: typeof data.walletAddress === "string" ? data.walletAddress : undefined,
    email: typeof data.email === "string" ? data.email : undefined,
    quoteCurrency: typeof data.quoteCurrency === "string" ? data.quoteCurrency : undefined,
    baseCurrency: typeof data.baseCurrency === "string" ? data.baseCurrency : undefined,
    providerData:
      data.providerData && typeof data.providerData === "object"
        ? (data.providerData as Record<string, unknown>)
        : undefined,
    compliance: compliance ?? undefined,
  };
};

export const getSaleorActionType = (actionType: string): SaleorActionType =>
  actionType === "AUTHORIZATION" ? "AUTHORIZATION" : "CHARGE";
