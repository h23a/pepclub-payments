import { withErrorHandling, withMethodGuard } from "@/modules/core/http";
import { createDashboardProtectedHandler } from "@/modules/dashboard/protected-handler";
import { getDiagnostics } from "@/modules/dashboard/service";

const handler = withErrorHandling(
  withMethodGuard(
    "GET",
    createDashboardProtectedHandler(async (_request, response, context) => {
      const diagnostics = await getDiagnostics(context.authData);
      response.status(200).json(diagnostics);
    })
  )
);

export default handler;
