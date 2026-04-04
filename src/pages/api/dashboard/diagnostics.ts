import { withErrorHandling, withMethodGuard } from "@/modules/core/http";
import { createPaymentsProtectedHandler } from "@/modules/core/protected-handler";
import { getDiagnostics } from "@/modules/dashboard/service";

const handler = withErrorHandling(
  withMethodGuard(
    "GET",
    createPaymentsProtectedHandler(async (_request, response, context) => {
      const diagnostics = await getDiagnostics(context.authData);
      response.status(200).json(diagnostics);
    })
  )
);

export default handler;
