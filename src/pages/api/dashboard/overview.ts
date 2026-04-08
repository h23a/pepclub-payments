import { withErrorHandling, withMethodGuard } from "@/modules/core/http";
import { createPaymentsProtectedHandler } from "@/modules/core/protected-handler";
import { getDashboardOverview } from "@/modules/dashboard/service";

const handler = withErrorHandling(
  withMethodGuard(
    "GET",
    createPaymentsProtectedHandler(async (request, response, context) => {
      const range = typeof request.query.range === "string" ? request.query.range : null;
      const from = typeof request.query.from === "string" ? request.query.from : null;
      const to = typeof request.query.to === "string" ? request.query.to : null;
      const overview = await getDashboardOverview(context.authData, { range, from, to });
      response.status(200).json(overview);
    })
  )
);

export default handler;
