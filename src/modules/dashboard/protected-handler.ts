import { createProtectedHandler } from "@saleor/app-sdk/handlers/next";

import { saleorApp } from "@/saleor-app";

export const dashboardPermissions = ["HANDLE_PAYMENTS"] as const;

export const createDashboardProtectedHandler = (
  handler: Parameters<typeof createProtectedHandler>[0]
) => createProtectedHandler(handler, saleorApp.apl, [...dashboardPermissions]);
