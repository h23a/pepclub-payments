import { withErrorHandling, withMethodGuard } from "@/modules/core/http";
import { createDashboardProtectedHandler } from "@/modules/dashboard/protected-handler";
import { lookupTransactions } from "@/modules/dashboard/service";
import { parseDashboardTransactionsQuery } from "@/modules/dashboard/validation";

const handler = withErrorHandling(
  withMethodGuard(
    "GET",
    createDashboardProtectedHandler(async (request, response, context) => {
      const { search, page } = parseDashboardTransactionsQuery(request.query);
      const transactions = await lookupTransactions(context.authData, { search, page });

      response.status(200).json(transactions);
    })
  )
);

export default handler;
