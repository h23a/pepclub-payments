import crypto from "crypto";

import { withErrorHandling, withMethodGuard } from "@/modules/core/http";
import { createPaymentsProtectedHandler } from "@/modules/core/protected-handler";
import { parseMoonPaySignUrlBody } from "@/modules/dashboard/validation";
import { buildSignedMoonPayUrl } from "@/modules/payments/providers/moonpay";

const handler = withErrorHandling(
  withMethodGuard(
    "POST",
    createPaymentsProtectedHandler(async (request, response, context) => {
      const payload = parseMoonPaySignUrlBody(request.body);

      const url = buildSignedMoonPayUrl({
        saleorApiUrl: context.authData.saleorApiUrl,
        amount: payload.amount,
        currency: payload.currency,
        merchantReference: payload.merchantReference ?? payload.transactionId ?? "manual",
        transactionId: payload.transactionId ?? crypto.randomUUID(),
        idempotencyKey: payload.idempotencyKey ?? payload.transactionId ?? crypto.randomUUID(),
        customerEmail: payload.email ?? null,
        customerIpAddress: null,
        baseUrl: context.baseUrl,
        gatewayData: {
          baseCurrency: payload.baseCurrency,
          quoteCurrency: payload.quoteCurrency,
          walletAddress: payload.walletAddress,
          email: payload.email,
        },
        sourceObjectId: payload.sourceObjectId ?? "manual",
        sourceObjectType: "CHECKOUT",
      });

      response.status(200).json({ url });
    })
  )
);

export default handler;
