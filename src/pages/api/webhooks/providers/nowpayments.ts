import { NextApiHandler } from "next";

import {
  getBaseUrlFromHeaders,
  parseJsonBody,
  readRawRequestBody,
  toHeaders,
  withErrorHandling,
  withMethodGuard,
} from "@/modules/core/http";
import { logger } from "@/modules/core/logger";
import { reconcileProviderWebhook } from "@/modules/payments/service";
import { saleorApp } from "@/saleor-app";

const handler: NextApiHandler = withErrorHandling(
  withMethodGuard("POST", async (request, response) => {
    const rawBody = await readRawRequestBody(request);
    const payload = rawBody ? parseJsonBody(rawBody) : {};
    const session = await reconcileProviderWebhook({
      providerKey: "nowpayments",
      rawBody,
      payload,
      headers: toHeaders(request.headers),
      baseUrl: getBaseUrlFromHeaders(request.headers) ?? "",
      authDataLoader: (saleorApiUrl) => saleorApp.apl.get(saleorApiUrl),
    });

    logger.info("NOWPayments webhook reconciled", {
      providerPaymentId: session.providerPaymentId,
      providerStatus: session.providerStatus,
      saleorTransactionId: session.saleorTransactionId,
    });
    response.status(200).json({ ok: true });
  })
);

export default handler;

export const config = {
  api: {
    bodyParser: false,
  },
};
