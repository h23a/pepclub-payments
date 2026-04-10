import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";

import {
  TransactionInitializeSessionPayloadFragment,
  TransactionInitializeSessionSubscriptionDocument,
} from "@/generated/graphql";
import { logger } from "@/modules/core/logger";
import { createFailureSyncResponse, initializePaymentSession } from "@/modules/payments/service";
import { getSaleorActionType } from "@/modules/saleor/types";
import { saleorApp } from "@/saleor-app";

export const transactionInitializeSessionWebhook =
  new SaleorSyncWebhook<TransactionInitializeSessionPayloadFragment>({
    name: "Pepclub Payments Transaction Initialize Session",
    webhookPath: "api/webhooks/transaction/initialize",
    event: "TRANSACTION_INITIALIZE_SESSION",
    apl: saleorApp.apl,
    query: TransactionInitializeSessionSubscriptionDocument,
  });

export default transactionInitializeSessionWebhook.createHandler(async (req, res, ctx) => {
  try {
    const result = await initializePaymentSession({
      payload: ctx.payload,
      authData: ctx.authData,
      baseUrl: ctx.baseUrl,
    });

    return res.status(200).json(result.response);
  } catch (error) {
    logger.warn("Transaction initialize session failed", {
      error: error instanceof Error ? error.message : String(error),
      billingCountry: ctx.payload.sourceObject.billingAddress?.country.code ?? null,
      shippingCountry: ctx.payload.sourceObject.shippingAddress?.country.code ?? null,
      sourceObjectId: ctx.payload.sourceObject.id,
      sourceObjectType: ctx.payload.sourceObject.__typename,
      transactionId: ctx.payload.transaction.id,
    });

    return res
      .status(200)
      .json(
        createFailureSyncResponse(
          error,
          getSaleorActionType(ctx.payload.action.actionType),
          ctx.payload.action.amount,
        ),
      );
  }
});

export const config = {
  api: {
    bodyParser: false,
  },
};
