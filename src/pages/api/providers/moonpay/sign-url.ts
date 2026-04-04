import crypto from "crypto";

import { parseJsonBody, withErrorHandling, withMethodGuard } from "@/modules/core/http";
import { createPaymentsProtectedHandler } from "@/modules/core/protected-handler";
import { buildSignedMoonPayUrl } from "@/modules/payments/providers/moonpay";

const handler = withErrorHandling(
  withMethodGuard(
    "POST",
    createPaymentsProtectedHandler(async (request, response, context) => {
      const payload = parseJsonBody<Record<string, unknown>>(request.body);

      const url = buildSignedMoonPayUrl({
        saleorApiUrl: context.authData.saleorApiUrl,
        amount: Number(payload.amount ?? 0),
        currency: String(payload.currency ?? "USD"),
        merchantReference: String(payload.merchantReference ?? payload.transactionId ?? "manual"),
        transactionId: String(payload.transactionId ?? crypto.randomUUID()),
        idempotencyKey: String(payload.idempotencyKey ?? payload.transactionId ?? crypto.randomUUID()),
        customerEmail: typeof payload.email === "string" ? payload.email : null,
        customerIpAddress: null,
        baseUrl: context.baseUrl,
        gatewayData: {
          baseCurrency: typeof payload.baseCurrency === "string" ? payload.baseCurrency : undefined,
          quoteCurrency: typeof payload.quoteCurrency === "string" ? payload.quoteCurrency : undefined,
          walletAddress:
            typeof payload.walletAddress === "string" ? payload.walletAddress : undefined,
          email: typeof payload.email === "string" ? payload.email : undefined,
        },
        sourceObjectId: String(payload.sourceObjectId ?? "manual"),
        sourceObjectType: "CHECKOUT",
      });

      response.status(200).json({ url });
    })
  )
);

export default handler;
