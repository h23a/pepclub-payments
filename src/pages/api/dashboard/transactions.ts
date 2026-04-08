import { withErrorHandling, withMethodGuard } from "@/modules/core/http";
import { createPaymentsProtectedHandler } from "@/modules/core/protected-handler";
import { lookupTransactions } from "@/modules/dashboard/service";

const handler = withErrorHandling(
  withMethodGuard(
    "GET",
    createPaymentsProtectedHandler(async (request, response, context) => {
      const search = typeof request.query.search === "string" ? request.query.search : undefined;
      const parsedPage =
        typeof request.query.page === "string" ? Number.parseInt(request.query.page, 10) : 1;
      const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
      const transactions = await lookupTransactions(context.authData, { search, page });

      response.status(200).json(transactions);
    })
  )
);

export default handler;
