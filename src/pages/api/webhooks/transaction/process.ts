import { SaleorSyncWebhook } from "@saleor/app-sdk/handlers/next";

import {
  TransactionProcessSessionPayloadFragment,
  TransactionProcessSessionSubscriptionDocument,
} from "@/generated/graphql";
import { logger } from "@/modules/core/logger";
import { createFailureSyncResponse, processPaymentSession } from "@/modules/payments/service";
import { getSaleorActionType } from "@/modules/saleor/types";
import { saleorApp } from "@/saleor-app";

export const transactionProcessSessionWebhook =
  new SaleorSyncWebhook<TransactionProcessSessionPayloadFragment>({
    name: "Pepclub Payments Transaction Process Session",
    webhookPath: "api/webhooks/transaction/process",
    event: "TRANSACTION_PROCESS_SESSION",
    apl: saleorApp.apl,
    query: TransactionProcessSessionSubscriptionDocument,
  });

export default transactionProcessSessionWebhook.createHandler(async (req, res, ctx) => {
  try {
    const result = await processPaymentSession({
      payload: ctx.payload,
      authData: ctx.authData,
    });

    return res.status(200).json(result.response);
  } catch (error) {
    logger.warn("Transaction process session failed", {
      error: error instanceof Error ? error.message : String(error),
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
