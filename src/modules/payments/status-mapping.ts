import {
  FinalizationState,
  SaleorActionType,
  SaleorPaymentStatus,
} from "@/modules/payments/types";

export const getFinalizationState = (status: SaleorPaymentStatus): FinalizationState =>
  ["SUCCESS", "AUTHORIZED", "FAILED", "CANCELLED", "EXPIRED"].includes(status)
    ? "finalized"
    : "pending";

export const mapNowPaymentsStatus = (status: string): SaleorPaymentStatus => {
  const normalized = status.toLowerCase();

  if (normalized === "finished") {
    return "SUCCESS";
  }

  if (["waiting", "confirming", "confirmed", "partially_paid", "processing"].includes(normalized)) {
    return "PENDING";
  }

  if (["failed", "rejected", "rejected_not_checked"].includes(normalized)) {
    return "FAILED";
  }

  if (normalized === "expired") {
    return "EXPIRED";
  }

  if (["cancelled", "canceled"].includes(normalized)) {
    return "CANCELLED";
  }

  return "UNKNOWN";
};

export const mapMoonPayStatus = (status: string): SaleorPaymentStatus => {
  const normalized = status.toLowerCase();

  if (["completed", "success", "delivered"].includes(normalized)) {
    return "SUCCESS";
  }

  if (normalized.includes("pending") || normalized.includes("waiting") || normalized === "in_aml_review") {
    return "PENDING";
  }

  if (["failed", "rejected", "aml_rejected"].includes(normalized)) {
    return "FAILED";
  }

  if (["cancelled", "canceled"].includes(normalized)) {
    return "CANCELLED";
  }

  if (normalized === "expired") {
    return "EXPIRED";
  }

  return "UNKNOWN";
};

export const mapSaleorStatusToSyncResult = (
  saleorStatus: SaleorPaymentStatus,
  actionType: SaleorActionType
) => {
  if (saleorStatus === "SUCCESS") {
    return actionType === "AUTHORIZATION" ? "AUTHORIZATION_SUCCESS" : "CHARGE_SUCCESS";
  }

  if (saleorStatus === "AUTHORIZED") {
    return "AUTHORIZATION_SUCCESS";
  }

  if (saleorStatus === "ACTION_REQUIRED") {
    return actionType === "AUTHORIZATION"
      ? "AUTHORIZATION_ACTION_REQUIRED"
      : "CHARGE_ACTION_REQUIRED";
  }

  if (saleorStatus === "PENDING") {
    return actionType === "AUTHORIZATION" ? "AUTHORIZATION_REQUEST" : "CHARGE_REQUEST";
  }

  return actionType === "AUTHORIZATION" ? "AUTHORIZATION_FAILURE" : "CHARGE_FAILURE";
};
