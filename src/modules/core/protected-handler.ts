import { createProtectedHandler } from "@saleor/app-sdk/handlers/next";

import { saleorApp } from "@/saleor-app";

export const paymentsProtectedPermissions = ["HANDLE_PAYMENTS"] as const;

export const createPaymentsProtectedHandler = (
  handler: Parameters<typeof createProtectedHandler>[0]
) => createProtectedHandler(handler, saleorApp.apl, [...paymentsProtectedPermissions]);
