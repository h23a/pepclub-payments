import { AuthData } from "@saleor/app-sdk/APL";

import { SaleorCallbackError } from "@/modules/core/errors";
import { logger } from "@/modules/core/logger";
import { PaymentSessionRecord, SaleorActionType, SaleorPaymentStatus } from "@/modules/payments/types";

type GraphQLErrorShape = {
  message: string;
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: GraphQLErrorShape[];
};

const saleorFetch = async <TData, TVariables extends Record<string, unknown>>(
  authData: AuthData,
  query: string,
  variables: TVariables
) => {
  const response = await fetch(authData.saleorApiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${authData.token}`,
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  const payload = (await response.json()) as GraphQLResponse<TData>;

  if (!response.ok || payload.errors?.length) {
    throw new SaleorCallbackError("Saleor GraphQL request failed.", {
      status: response.status,
      errors: payload.errors,
    });
  }

  if (!payload.data) {
    throw new SaleorCallbackError("Saleor GraphQL response did not include data.");
  }

  return payload.data;
};

const statusToEventType = (status: SaleorPaymentStatus, actionType: SaleorActionType) => {
  if (status === "ACTION_REQUIRED") {
    return actionType === "AUTHORIZATION"
      ? "AUTHORIZATION_ACTION_REQUIRED"
      : "CHARGE_ACTION_REQUIRED";
  }

  if (status === "PENDING") {
    return actionType === "AUTHORIZATION" ? "AUTHORIZATION_REQUEST" : "CHARGE_REQUEST";
  }

  if (status === "SUCCESS") {
    return actionType === "AUTHORIZATION" ? "AUTHORIZATION_SUCCESS" : "CHARGE_SUCCESS";
  }

  if (status === "AUTHORIZED") {
    return "AUTHORIZATION_SUCCESS";
  }

  return actionType === "AUTHORIZATION" ? "AUTHORIZATION_FAILURE" : "CHARGE_FAILURE";
};

const transactionEventReportMutation = /* GraphQL */ `
  mutation ReportTransactionEvent(
    $token: UUID
    $pspReference: String!
    $type: TransactionEventTypeEnum!
    $amount: PositiveDecimal
    $message: String
    $externalUrl: String
    $time: DateTime
    $availableActions: [TransactionActionEnum!]
  ) {
    transactionEventReport(
      token: $token
      pspReference: $pspReference
      type: $type
      amount: $amount
      message: $message
      externalUrl: $externalUrl
      time: $time
      availableActions: $availableActions
    ) {
      alreadyProcessed
      errors {
        code
        field
        message
      }
      transactionEvent {
        type
        pspReference
      }
    }
  }
`;

export const reportTransactionEvent = async (input: {
  authData: AuthData;
  session: PaymentSessionRecord;
  status: SaleorPaymentStatus;
  actionType: SaleorActionType;
  message?: string | null;
  externalUrl?: string | null;
}) => {
  if (!input.session.saleorTransactionToken) {
    logger.warn("Skipping Saleor callback because transaction token is missing", {
      transactionId: input.session.saleorTransactionId,
    });
    return null;
  }

  const eventType = statusToEventType(input.status, input.actionType);

  const data = await saleorFetch<{
    transactionEventReport: {
      alreadyProcessed?: boolean | null;
      errors: { code: string; field?: string | null; message?: string | null }[];
    };
  }, {
    token: string;
    pspReference: string;
    type: string;
    amount: number;
    message?: string | null;
    externalUrl?: string | null;
    time: string;
    availableActions: string[];
  }>(input.authData, transactionEventReportMutation, {
    token: input.session.saleorTransactionToken,
    pspReference:
      input.session.providerReferenceId ??
      input.session.providerPaymentId ??
      input.session.providerInvoiceId ??
      input.session.saleorMerchantReference,
    type: eventType,
    amount: Number(input.session.amount),
    message: input.message ?? undefined,
    externalUrl: input.externalUrl ?? input.session.redirectUrl ?? input.session.hostedUrl ?? undefined,
    time: new Date().toISOString(),
    availableActions: [],
  });

  if (data.transactionEventReport.errors.length > 0) {
    throw new SaleorCallbackError("Saleor transactionEventReport returned errors.", {
      errors: data.transactionEventReport.errors,
      transactionId: input.session.saleorTransactionId,
    });
  }

  return data.transactionEventReport;
};
