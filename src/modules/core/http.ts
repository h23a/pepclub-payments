import { NextApiHandler, NextApiRequest } from "next";

import { AppError, isAppError, ValidationError } from "@/modules/core/errors";
import { logger } from "@/modules/core/logger";

type ApiHandler<T = unknown> = NextApiHandler<T>;

export const withMethodGuard =
  <T = unknown>(method: string | string[], handler: ApiHandler<T>): NextApiHandler<T> =>
  async (request, response) => {
    const methods = Array.isArray(method) ? method : [method];

    if (!request.method || !methods.includes(request.method)) {
      response.setHeader("Allow", methods.join(", "));
      response.status(405).json({
        code: "METHOD_NOT_ALLOWED",
        error: "Method Not Allowed",
      } as T);
      return;
    }

    await handler(request, response);
  };

export const withErrorHandling =
  <T = unknown>(handler: ApiHandler<T>): NextApiHandler<T> =>
  async (request, response) => {
    try {
      await handler(request, response);
    } catch (error) {
      const appError = normalizeError(error);

      logger.error(appError.adminMessage, {
        code: appError.code,
        details: appError.details,
        path: request.url,
      });

      response.status(appError.statusCode).json({
        code: appError.code,
        error: appError.safeMessage,
      } as T);
    }
  };

export const parseJsonBody = <T>(body: unknown): T => {
  if (typeof body === "string") {
    return JSON.parse(body) as T;
  }

  return body as T;
};

export const readRawRequestBody = async (request: NextApiRequest) => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
};

export const getBaseUrlFromHeaders = (
  headers: Record<string, string | string[] | undefined>
) => {
  const host = headers.host;
  const forwardedProto = headers["x-forwarded-proto"];

  const normalizedHost = Array.isArray(host) ? host[0] : host;
  const normalizedProto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;

  if (!normalizedHost) {
    return null;
  }

  return `${normalizedProto ?? "https"}://${normalizedHost}`;
};

export const toHeaders = (headers: Record<string, string | string[] | undefined>) =>
  new Headers(
    Object.entries(headers).reduce<Record<string, string>>((acc, [key, value]) => {
      if (typeof value === "string") {
        acc[key] = value;
      }

      return acc;
    }, {})
  );

const normalizeError = (error: unknown) => {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof SyntaxError) {
    return new ValidationError("Request body is not valid JSON.", {
      adminMessage: error.message,
      cause: error,
      safeMessage: "Submitted data is invalid.",
    });
  }

  if (error instanceof Error) {
    return new AppError("UNEXPECTED_ERROR", error.message, {
      adminMessage: error.message,
      cause: error,
      safeMessage: "Unexpected server error.",
      statusCode: 500,
    });
  }

  return new AppError("UNEXPECTED_ERROR", "Unexpected server error.", {
    cause: error,
    adminMessage: "Unexpected server error.",
    safeMessage: "Unexpected server error.",
    statusCode: 500,
  });
};
