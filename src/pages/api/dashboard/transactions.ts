import { withErrorHandling, withMethodGuard } from "@/modules/core/http";
import { createPaymentsProtectedHandler } from "@/modules/core/protected-handler";
import { lookupTransactions } from "@/modules/dashboard/service";

const handler = withErrorHandling(
  withMethodGuard(
    "GET",
    createPaymentsProtectedHandler(async (request, response, context) => {
      const search = typeof request.query.search === "string" ? request.query.search : undefined;
      const transactions = await lookupTransactions(context.authData, search);

      response.status(200).json(transactions);
    })
  )
);

export default handler;
