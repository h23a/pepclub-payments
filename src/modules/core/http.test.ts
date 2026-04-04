import { describe, expect, it, vi } from "vitest";

import { ValidationError } from "@/modules/core/errors";
import { parseJsonBody, withErrorHandling, withMethodGuard } from "@/modules/core/http";

const createResponse = () => {
  const response = {
    json: vi.fn(),
    setHeader: vi.fn(),
    status: vi.fn(),
  };

  response.status.mockReturnValue(response);

  return response;
};

describe("core/http", () => {
  it("guards unsupported methods and sets Allow header", async () => {
    const response = createResponse();
    const handler = withMethodGuard("POST", vi.fn());

    await handler({ method: "GET" } as never, response as never);

    expect(response.setHeader).toHaveBeenCalledWith("Allow", "POST");
    expect(response.status).toHaveBeenCalledWith(405);
    expect(response.json).toHaveBeenCalledWith({
      code: "METHOD_NOT_ALLOWED",
      error: "Method Not Allowed",
    });
  });

  it("normalizes app errors into the shared error contract", async () => {
    const response = createResponse();
    const handler = withErrorHandling(async () => {
      throw new ValidationError("Invalid payload.");
    });

    await handler({ url: "/api/test" } as never, response as never);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      code: "VALIDATION_ERROR",
      error: "The payment request is invalid.",
    });
  });

  it("parses JSON bodies from either strings or objects", () => {
    expect(parseJsonBody<{ ok: boolean }>("{\"ok\":true}")).toEqual({ ok: true });
    expect(parseJsonBody({ ok: true })).toEqual({ ok: true });
  });
});
