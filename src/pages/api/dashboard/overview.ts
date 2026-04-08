import { withErrorHandling, withMethodGuard } from "@/modules/core/http";
import { createDashboardProtectedHandler } from "@/modules/dashboard/protected-handler";
import { getDashboardOverview } from "@/modules/dashboard/service";
import { parseDashboardOverviewQuery } from "@/modules/dashboard/validation";

const handler = withErrorHandling(
  withMethodGuard(
    "GET",
    createDashboardProtectedHandler(async (request, response, context) => {
      const { range, from, to } = parseDashboardOverviewQuery(request.query);
      const overview = await getDashboardOverview(context.authData, { range, from, to });
      response.status(200).json(overview);
    })
  )
);

export default handler;
