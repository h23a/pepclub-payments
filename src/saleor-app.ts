import { APL } from "@saleor/app-sdk/APL";
import { FileAPL } from "@saleor/app-sdk/APL/file";
import { SaleorApp } from "@saleor/app-sdk/saleor-app";

import { PostgresAPL } from "@/modules/app/postgres-apl";
import { getEnv } from "@/modules/config/env";

/**
 * By default auth data are stored in the `.auth-data.json` (FileAPL).
 * For multi-tenant applications and deployments please use UpstashAPL.
 *
 * To read more about storing auth data, read the
 * [APL documentation](https://github.com/saleor/saleor-app-sdk/blob/main/docs/apl.md)
 */
export let apl: APL;
const env = getEnv();

switch (env.apl) {
  /**
   * Depending on env variables, chose what APL to use.
   * To reduce the footprint, import only these needed
   z
   * TODO: See docs
   */
  case "file":
    apl = new FileAPL();
    break;
  default:
    apl = new PostgresAPL();
}

export const saleorApp = new SaleorApp({
  apl,
});
