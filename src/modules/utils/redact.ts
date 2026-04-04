const REDACTED_VALUE = "[REDACTED]";
const SECRET_KEY_PATTERNS = [
  "secret",
  "token",
  "authorization",
  "signature",
  "password",
  "apiKey",
  "privateKey",
];

const shouldRedact = (key: string) =>
  SECRET_KEY_PATTERNS.some((pattern) => key.toLowerCase().includes(pattern.toLowerCase()));

export const redactSecrets = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>(
      (acc, [key, nestedValue]) => {
        acc[key] = shouldRedact(key) ? REDACTED_VALUE : redactSecrets(nestedValue);
        return acc;
      },
      {}
    );
  }

  return value;
};

export const maskSecret = (value: string | null | undefined) => {
  if (!value) {
    return "missing";
  }

  if (value.length <= 8) {
    return "configured";
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
};
