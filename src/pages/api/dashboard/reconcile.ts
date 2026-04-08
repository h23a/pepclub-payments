import { withErrorHandling, withMethodGuard } from "@/modules/core/http";
import { createDashboardProtectedHandler } from "@/modules/dashboard/protected-handler";
import { reconcileTransactionById } from "@/modules/dashboard/service";
import { parseReconcileRequestBody } from "@/modules/dashboard/validation";

const handler = withErrorHandling(
  withMethodGuard(
    "POST",
    createDashboardProtectedHandler(async (request, response, context) => {
      const { saleorTransactionId } = parseReconcileRequestBody(request.body);
      const result = await reconcileTransactionById(context.authData, saleorTransactionId);

      response.status(200).json(result);
    })
  )
);

export default handler;
