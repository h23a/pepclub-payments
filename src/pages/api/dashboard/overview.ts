import { withErrorHandling, withMethodGuard } from "@/modules/core/http";
import { createPaymentsProtectedHandler } from "@/modules/core/protected-handler";
import { getDashboardOverview } from "@/modules/dashboard/service";

const handler = withErrorHandling(
  withMethodGuard(
    "GET",
    createPaymentsProtectedHandler(async (_request, response, context) => {
      const overview = await getDashboardOverview(context.authData);
      response.status(200).json(overview);
    })
  )
);

export default handler;
