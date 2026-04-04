type ErrorOptions = {
  adminMessage?: string;
  cause?: unknown;
  details?: Record<string, unknown>;
  safeMessage?: string;
  statusCode?: number;
};

export class AppError extends Error {
  readonly adminMessage: string;
  readonly cause?: unknown;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly safeMessage: string;
  readonly statusCode: number;

  constructor(code: string, message: string, options: ErrorOptions = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.cause = options.cause;
    this.details = options.details;
    this.safeMessage = options.safeMessage ?? "Request could not be completed.";
    this.adminMessage = options.adminMessage ?? message;
    this.statusCode = options.statusCode ?? 500;
  }
}

const resolveErrorOptions = (
  safeMessageOrOptions: ErrorOptions | string | undefined,
  details?: Record<string, unknown>,
  defaults?: Pick<ErrorOptions, "safeMessage" | "statusCode">
) => {
  if (typeof safeMessageOrOptions === "string") {
    return {
      details,
      safeMessage: safeMessageOrOptions,
      statusCode: defaults?.statusCode,
    } satisfies ErrorOptions;
  }

  return {
    ...defaults,
    ...safeMessageOrOptions,
    details: safeMessageOrOptions?.details ?? details,
  } satisfies ErrorOptions;
};

export class ValidationError extends AppError {
  constructor(
    message: string,
    safeMessageOrOptions: ErrorOptions | string = "The payment request is invalid.",
    details?: Record<string, unknown>
  ) {
    super(
      "VALIDATION_ERROR",
      message,
      resolveErrorOptions(safeMessageOrOptions, details, {
        safeMessage: "The payment request is invalid.",
        statusCode: 400,
      })
    );
  }
}

export class UnsupportedProviderError extends AppError {
  constructor(provider: string) {
    super("UNSUPPORTED_PROVIDER", `Provider "${provider}" is not supported.`, {
      details: { provider },
      safeMessage: "The selected payment provider is not available.",
      statusCode: 400,
    });
  }
}

export class ProviderConfigError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("PROVIDER_CONFIG_ERROR", message, {
      details,
      safeMessage: "The selected payment provider is not configured correctly.",
      statusCode: 503,
    });
  }
}

export class ProviderApiError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("PROVIDER_API_ERROR", message, {
      details,
      safeMessage: "The payment provider is temporarily unavailable. Please try again.",
      statusCode: 502,
    });
  }
}

export class SignatureVerificationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("SIGNATURE_VERIFICATION_ERROR", message, {
      details,
      safeMessage: "We could not verify the payment notification.",
      statusCode: 401,
    });
  }
}

export class ReconciliationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("RECONCILIATION_ERROR", message, {
      details,
      safeMessage: "We could not refresh the payment status right now.",
      statusCode: 409,
    });
  }
}

export class PersistenceError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("PERSISTENCE_ERROR", message, {
      details,
      safeMessage: "We could not persist the payment state.",
      statusCode: 500,
    });
  }
}

export class ComplianceValidationError extends AppError {
  constructor(
    message: string,
    safeMessageOrOptions: ErrorOptions | string = "You must complete the required waiver before paying.",
    details?: Record<string, unknown>
  ) {
    super(
      "COMPLIANCE_VALIDATION_ERROR",
      message,
      resolveErrorOptions(safeMessageOrOptions, details, {
        safeMessage: "You must complete the required waiver before paying.",
        statusCode: 409,
      })
    );
  }
}

export class SaleorCallbackError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("SALEOR_CALLBACK_ERROR", message, {
      details,
      safeMessage: "The payment was updated, but Saleor has not been notified yet.",
      statusCode: 502,
    });
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;
