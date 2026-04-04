import { NextApiHandler } from "next";

import { getEnv } from "@/modules/config/env";
import { checkDatabaseConnection } from "@/modules/db/client";
import { getAvailableProviders } from "@/modules/payments/providers";

const handler: NextApiHandler = async (_req, res) => {
  const database = await checkDatabaseConnection();
  const providers = getAvailableProviders().map((provider) => provider.getDashboardStatus());
  const ok = database.ok && providers.every((provider) => !provider.enabled || provider.isConfigured);

  return res.status(ok ? 200 : 503).json({
    ok,
    environment: getEnv().nodeEnv,
    database,
    providers,
  });
};

export default handler;
