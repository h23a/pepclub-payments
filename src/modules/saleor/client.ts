import { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { AuthData } from "@saleor/app-sdk/APL";
import { print } from "graphql";

import {
  TransactionEventReportDocument,
  TransactionEventReportMutation,
  TransactionEventReportMutationVariables,
  TransactionEventTypeEnum,
} from "@/generated/graphql";
import { SaleorCallbackError } from "@/modules/core/errors";
import { logger } from "@/modules/core/logger";
import {
  PaymentSessionRecord,
  SaleorActionType,
  SaleorPaymentStatus,
} from "@/modules/payments/types";

type GraphQLErrorShape = {
  message: string;
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: GraphQLErrorShape[];
};

const saleorFetch = async <TData, TVariables extends Record<string, unknown>>(
  authData: AuthData,
  document: TypedDocumentNode<TData, TVariables>,
  variables: TVariables,
) => {
  const response = await fetch(authData.saleorApiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${authData.token}`,
    },
    body: JSON.stringify({
      query: print(document),
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

const statusToEventType = (
  status: SaleorPaymentStatus,
  actionType: SaleorActionType,
): TransactionEventTypeEnum => {
  if (status === "ACTION_REQUIRED") {
    return actionType === "AUTHORIZATION"
      ? TransactionEventTypeEnum.AuthorizationActionRequired
      : TransactionEventTypeEnum.ChargeActionRequired;
  }

  if (status === "PENDING") {
    return actionType === "AUTHORIZATION"
      ? TransactionEventTypeEnum.AuthorizationRequest
      : TransactionEventTypeEnum.ChargeRequest;
  }

  if (status === "SUCCESS") {
    return actionType === "AUTHORIZATION"
      ? TransactionEventTypeEnum.AuthorizationSuccess
      : TransactionEventTypeEnum.ChargeSuccess;
  }

  if (status === "AUTHORIZED") {
    return TransactionEventTypeEnum.AuthorizationSuccess;
  }

  return actionType === "AUTHORIZATION"
    ? TransactionEventTypeEnum.AuthorizationFailure
    : TransactionEventTypeEnum.ChargeFailure;
};

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

  const data = await saleorFetch<
    TransactionEventReportMutation,
    TransactionEventReportMutationVariables
  >(input.authData, TransactionEventReportDocument, {
    token: input.session.saleorTransactionToken,
    pspReference:
      input.session.providerReferenceId ??
      input.session.providerPaymentId ??
      input.session.providerInvoiceId ??
      input.session.saleorMerchantReference,
    type: eventType,
    amount: Number(input.session.amount),
    message: input.message ?? undefined,
    externalUrl:
      input.externalUrl ?? input.session.redirectUrl ?? input.session.hostedUrl ?? undefined,
    time: new Date().toISOString(),
    availableActions: [],
  });
  const report = data.transactionEventReport;

  if (!report) {
    throw new SaleorCallbackError(
      "Saleor transactionEventReport response did not include a payload.",
      {
        transactionId: input.session.saleorTransactionId,
      },
    );
  }

  if (report.errors.length > 0) {
    throw new SaleorCallbackError("Saleor transactionEventReport returned errors.", {
      errors: report.errors,
      transactionId: input.session.saleorTransactionId,
    });
  }

  return report;
};
