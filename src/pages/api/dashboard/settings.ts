import { parseJsonBody, withErrorHandling, withMethodGuard } from "@/modules/core/http";
import { createPaymentsProtectedHandler } from "@/modules/core/protected-handler";
import { saveDashboardSettings } from "@/modules/dashboard/service";

const handler = withErrorHandling(
  withMethodGuard(
    "POST",
    createPaymentsProtectedHandler(async (request, response, context) => {
      const payload = parseJsonBody<Record<string, unknown>>(request.body);

      const settings = await saveDashboardSettings(context.authData, {
        defaultProvider: payload.defaultProvider as "nowpayments" | "moonpay" | "rampnetwork",
        nowpaymentsEnabled: Boolean(payload.nowpaymentsEnabled),
        moonpayEnabled: Boolean(payload.moonpayEnabled),
        rampnetworkEnabled: Boolean(payload.rampnetworkEnabled),
      });

      response.status(200).json(settings);
    })
  )
);

export default handler;
