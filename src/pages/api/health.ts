import { getEnv } from "@/modules/config/env";
import { withErrorHandling, withMethodGuard } from "@/modules/core/http";
import { checkDatabaseConnection } from "@/modules/db/client";
import { getAvailableProviders } from "@/modules/payments/providers";

const handler = withErrorHandling(
  withMethodGuard("GET", async (_request, response) => {
    const env = getEnv();
    const database = await checkDatabaseConnection();
    const providers = getAvailableProviders().map((provider) => provider.getDashboardStatus());
    const warnings: string[] = [];

    if (!database.ok) {
      warnings.push(`Database connectivity issue: ${database.error}`);
    }

    if (!providers.some((provider) => provider.enabled && provider.isConfigured)) {
      warnings.push("No payment provider is both enabled and fully configured.");
    }

    const ok = warnings.length === 0;

    response.status(ok ? 200 : 503).json({
      app: "pepclub-payments",
      status: ok ? "ok" : "degraded",
      environment: env.nodeEnv,
      saleorApiUrl: env.saleorApiUrl,
      database,
      providers,
      warnings,
    });
  })
);

export default handler;
