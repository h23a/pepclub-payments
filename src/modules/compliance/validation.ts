import { getEnv } from "@/modules/config/env";
import { ComplianceValidationError, ValidationError } from "@/modules/core/errors";
import { logger } from "@/modules/core/logger";
import { ComplianceContract } from "@/modules/payments/types";
import { extractComplianceValue, SaleorSourceObject } from "@/modules/saleor/types";
import { isRecord } from "@/modules/utils/object";

const complianceContractSchemaFields = [
  "waiverAccepted",
  "waiverAcceptedAt",
  "waiverTextVersion",
  "complianceRecordId",
  "signatureMode",
] as const;

type ResolveComplianceInput = {
  gatewayDataContract?: Partial<ComplianceContract>;
  sourceObject: SaleorSourceObject;
  saleorApiUrl: string;
  merchantReference: string;
};

const extractMetadataContract = (sourceObject: SaleorSourceObject) => extractComplianceValue(sourceObject);

const fetchComplianceFromInternalApi = async (input: ResolveComplianceInput) => {
  const env = getEnv();

  if (!env.complianceAppInternalUrl || !env.complianceAppSharedSecret) {
    throw new ComplianceValidationError(
      "Compliance API mode is enabled but COMPLIANCE_APP_INTERNAL_URL or PEPCLUB_INTERNAL_API_SHARED_SECRET is missing.",
      "Payment is temporarily unavailable while compliance services are being configured."
    );
  }

  const payload = JSON.stringify({
    checkoutId: input.sourceObject.__typename === "Checkout" ? input.sourceObject.id : input.sourceObject.checkoutId,
    customerId: input.sourceObject.user?.id,
    orderId: input.sourceObject.__typename === "Order" ? input.sourceObject.id : undefined,
    customerEmail:
      input.sourceObject.__typename === "Checkout"
        ? input.sourceObject.email
        : input.sourceObject.userEmail,
  });

  const response = await fetch(
    `${env.complianceAppInternalUrl.replace(/\/$/, "")}/api/internal/compliance/status`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pepclub-shared-secret": env.complianceAppSharedSecret,
      },
      body: payload,
    }
  );

  if (!response.ok) {
    logger.warn("Compliance API returned a non-success response", {
      status: response.status,
      merchantReference: input.merchantReference,
    });
    throw new ComplianceValidationError(
      "Compliance API returned a non-success response.",
      "We could not confirm your compliance status. Please try again in a moment."
    );
  }

  const responsePayload = (await response.json()) as Partial<ComplianceContract> | null;

  return responsePayload;
};

const validateComplianceContract = (contract: Partial<ComplianceContract> | null): ComplianceContract => {
  const env = getEnv();

  if (!contract || !isRecord(contract)) {
    throw new ComplianceValidationError("Compliance contract is missing.");
  }

  const normalizedContract: Partial<ComplianceContract> = { ...contract };

  if (
    (!normalizedContract.waiverTextVersion || normalizedContract.waiverTextVersion === "") &&
    normalizedContract.complianceRecordId &&
    normalizedContract.waiverAccepted === true &&
    normalizedContract.waiverAcceptedAt &&
    normalizedContract.signatureMode
  ) {
    normalizedContract.waiverTextVersion = "unknown";
    logger.warn("Compliance contract is missing waiverTextVersion; using compatibility fallback.", {
      complianceRecordId: normalizedContract.complianceRecordId,
    });
  }

  for (const field of complianceContractSchemaFields) {
    if (
      normalizedContract[field] === undefined ||
      normalizedContract[field] === null ||
      normalizedContract[field] === ""
    ) {
      throw new ComplianceValidationError(`Compliance contract field "${field}" is missing.`);
    }
  }

  if (normalizedContract.waiverAccepted !== true) {
    throw new ComplianceValidationError("Compliance contract did not confirm waiverAccepted=true.");
  }

  if (normalizedContract.isPaymentAllowed === false) {
    throw new ComplianceValidationError(
      normalizedContract.adminReason ?? "Compliance policy rejected payment initialization.",
      normalizedContract.reason ?? "Payment is blocked until the required compliance steps are complete.",
      {
        complianceRecordId: normalizedContract.complianceRecordId,
        nextAction: normalizedContract.nextAction ?? null,
      }
    );
  }

  if (env.requireSignatureCompletion && normalizedContract.signatureCompleted !== true) {
    throw new ComplianceValidationError(
      "Compliance contract is missing signatureCompleted=true while strict mode is enabled."
    );
  }

  return {
    waiverAccepted: true,
    waiverAcceptedAt: normalizedContract.waiverAcceptedAt!,
    waiverTextVersion: normalizedContract.waiverTextVersion!,
    complianceRecordId: normalizedContract.complianceRecordId!,
    signatureMode: normalizedContract.signatureMode as ComplianceContract["signatureMode"],
    typedFullName: normalizedContract.typedFullName ?? null,
    signatureCompleted: normalizedContract.signatureCompleted ?? null,
    waiverStatus: normalizedContract.waiverStatus ?? null,
    ipAddressLoggedByComplianceApp: normalizedContract.ipAddressLoggedByComplianceApp ?? null,
    isPaymentAllowed: normalizedContract.isPaymentAllowed ?? null,
    reason: normalizedContract.reason ?? null,
    adminReason: normalizedContract.adminReason ?? null,
    nextAction: normalizedContract.nextAction ?? null,
  };
};

export const resolveComplianceContract = async (input: ResolveComplianceInput) => {
  const env = getEnv();
  const candidate =
    input.gatewayDataContract && Object.keys(input.gatewayDataContract).length > 0
      ? input.gatewayDataContract
      : env.complianceValidationMode === "metadata"
        ? extractMetadataContract(input.sourceObject)
        : await fetchComplianceFromInternalApi(input);

  return validateComplianceContract(candidate);
};

export const assertCompliancePreconditions = (contract: ComplianceContract) => {
  if (!contract.waiverAcceptedAt || Number.isNaN(Date.parse(contract.waiverAcceptedAt))) {
    throw new ValidationError(
      "Compliance contract waiverAcceptedAt must be an ISO timestamp.",
      "The waiver record is invalid. Please complete it again."
    );
  }

  return contract;
};
