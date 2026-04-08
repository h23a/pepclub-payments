import { withErrorHandling, withMethodGuard } from "@/modules/core/http";
import { createDashboardProtectedHandler } from "@/modules/dashboard/protected-handler";
import { saveDashboardSettings } from "@/modules/dashboard/service";
import { parseDashboardSettingsBody } from "@/modules/dashboard/validation";

const handler = withErrorHandling(
  withMethodGuard(
    "POST",
    createDashboardProtectedHandler(async (request, response, context) => {
      const payload = parseDashboardSettingsBody(request.body);

      const settings = await saveDashboardSettings(context.authData, payload);

      response.status(200).json(settings);
    })
  )
);

export default handler;
