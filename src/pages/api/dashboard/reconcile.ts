import { parseJsonBody, withErrorHandling, withMethodGuard } from "@/modules/core/http";
import { createPaymentsProtectedHandler } from "@/modules/core/protected-handler";
import { reconcileTransactionById } from "@/modules/dashboard/service";

const handler = withErrorHandling(
  withMethodGuard(
    "POST",
    createPaymentsProtectedHandler(async (request, response, context) => {
      const payload = parseJsonBody<Record<string, unknown>>(request.body);
      const saleorTransactionId = String(payload.saleorTransactionId ?? "");
      const result = await reconcileTransactionById(context.authData, saleorTransactionId);

      response.status(200).json(result);
    })
  )
);

export default handler;
