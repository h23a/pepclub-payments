type JsonLike = Record<string, unknown> | unknown[] | string | number | boolean | null;

export const sortObjectKeys = (input: JsonLike): JsonLike => {
  if (Array.isArray(input)) {
    return input.map((item) => sortObjectKeys(item as JsonLike));
  }

  if (input && typeof input === "object") {
    return Object.keys(input)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortObjectKeys((input as Record<string, unknown>)[key] as JsonLike);
        return acc;
      }, {});
  }

  return input;
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export const safeJsonParse = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};
