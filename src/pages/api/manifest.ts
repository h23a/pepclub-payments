import { createManifestHandler } from "@saleor/app-sdk/handlers/next";
import { AppManifest } from "@saleor/app-sdk/types";

import { getEnv } from "@/modules/config/env";
import packageJson from "@/package.json";

import { transactionInitializeSessionWebhook } from "./webhooks/transaction/initialize";
import { transactionProcessSessionWebhook } from "./webhooks/transaction/process";

/**
 * App SDK helps with the valid Saleor App Manifest creation. Read more:
 * https://github.com/saleor/saleor-app-sdk/blob/main/docs/api-handlers.md#manifest-handler-factory
 */
export default createManifestHandler({
  async manifestFactory({ appBaseUrl, request, schemaVersion }) {
    const env = getEnv();
    const iframeBaseUrl = env.appIframeBaseUrl ?? appBaseUrl;
    const apiBaseURL = env.appApiBaseUrl ?? appBaseUrl;
    const publicAssetBaseUrl = iframeBaseUrl;

    const manifest: AppManifest = {
      name: "Pepclub Payments",
      tokenTargetUrl: `${apiBaseURL}/api/register`,
      appUrl: iframeBaseUrl,
      permissions: ["HANDLE_PAYMENTS", "MANAGE_CHECKOUTS", "MANAGE_ORDERS"],
      id: "app.pepclub.payments",
      version: packageJson.version,
      webhooks: [
        transactionInitializeSessionWebhook.getWebhookManifest(apiBaseURL),
        transactionProcessSessionWebhook.getWebhookManifest(apiBaseURL),
      ],
      extensions: [],
      author: "Pepclub",
      brand: {
        logo: {
          default: `${publicAssetBaseUrl}/logo.png`,
        },
      },
    };

    return manifest;
  },
});
