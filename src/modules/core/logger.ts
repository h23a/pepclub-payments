import { getEnv } from "@/modules/config/env";

export type LogLevel = "debug" | "info" | "warn" | "error";

const priority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const redactedKeys = [
  "authorization",
  "authorization-bearer",
  "client_secret",
  "password",
  "refresh_token",
  "secret",
  "signature",
  "signurl",
  "token",
];

const redactValue = (value: unknown): unknown => {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(redactValue);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => {
      if (redactedKeys.some((redactedKey) => key.toLowerCase().includes(redactedKey))) {
        return [key, "[REDACTED]"];
      }

      return [key, redactValue(entryValue)];
    })
  );
};

const shouldLog = (level: LogLevel) => priority[level] >= priority[getEnv().logLevel];

const write = (level: LogLevel, message: string, context?: unknown) => {
  if (!shouldLog(level)) {
    return;
  }

  const payload = {
    level,
    message,
    context: context ? redactValue(context) : undefined,
    timestamp: new Date().toISOString(),
  };

  if (level === "error") {
    console.error(JSON.stringify(payload));
    return;
  }

  if (level === "warn") {
    console.warn(JSON.stringify(payload));
    return;
  }

  console.log(JSON.stringify(payload));
};

export const logger = {
  debug: (message: string, context?: unknown) => write("debug", message, context),
  error: (message: string, context?: unknown) => write("error", message, context),
  info: (message: string, context?: unknown) => write("info", message, context),
  warn: (message: string, context?: unknown) => write("warn", message, context),
  redactValue,
};
