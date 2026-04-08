import { ParsedUrlQuery } from "node:querystring";

import { z } from "zod";

import { ValidationError } from "@/modules/core/errors";
import { getSingleQueryValue, parseJsonBody } from "@/modules/core/http";
import { normalizeCountryCodes } from "@/modules/payments/country-restrictions";
import {
  type PaymentAppSettingsInput,
  type PaymentCountryRestrictionConfig,
  type PaymentCountryRestrictionMode,
  type PaymentProviderKey,
} from "@/modules/payments/types";

const dashboardRecapRanges = ["today", "7d", "month", "custom"] as const;
type DashboardRecapRange = (typeof dashboardRecapRanges)[number];
const defaultDashboardRecapRange: DashboardRecapRange = "7d";

const paymentProviderSchema = z.enum(["nowpayments", "moonpay", "rampnetwork"]);
const countryRestrictionModeSchema = z.enum(["allow_all", "allow_list", "block_list"]);
const dashboardRecapRangeSchema = z.enum(dashboardRecapRanges);
const dashboardOverviewRangeSchema = z.union([
  dashboardRecapRangeSchema,
  z.literal("24h"),
  z.literal("30d"),
]);

const nonEmptyTrimmedString = z
  .string()
  .trim()
  .min(1, "This field is required.");

const optionalTrimmedString = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}, z.string().optional());

const booleanInputSchema = z.union([
  z.boolean(),
  z
    .string()
    .trim()
    .transform((value, context) => {
      const normalized = value.toLowerCase();

      if (normalized === "true") {
        return true;
      }

      if (normalized === "false") {
        return false;
      }

      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected a boolean value.",
      });

      return z.NEVER;
    }),
]);

const optionalDateStringSchema = optionalTrimmedString.refine(
  (value) => value === undefined || !Number.isNaN(new Date(value).getTime()),
  {
    message: "Expected a valid date string.",
  }
);

const countryRestrictionsSchema: z.ZodType<PaymentCountryRestrictionConfig> = z.object({
  version: z.literal(1).optional().default(1),
  mode: countryRestrictionModeSchema,
  countries: z
    .array(z.string())
    .default([])
    .transform((countries) => normalizeCountryCodes(countries)),
  addressSource: z.literal("shipping_then_billing").optional().default("shipping_then_billing"),
});

const dashboardSettingsBodySchema: z.ZodType<PaymentAppSettingsInput> = z.object({
  defaultProvider: paymentProviderSchema,
  nowpaymentsEnabled: booleanInputSchema,
  moonpayEnabled: booleanInputSchema,
  rampnetworkEnabled: booleanInputSchema,
  countryRestrictions: countryRestrictionsSchema,
});

const reconcileRequestSchema = z.object({
  saleorTransactionId: nonEmptyTrimmedString,
});

const moonPaySignUrlBodySchema = z.object({
  amount: z.coerce.number().positive("Amount must be greater than zero."),
  currency: nonEmptyTrimmedString,
  merchantReference: optionalTrimmedString,
  transactionId: optionalTrimmedString,
  idempotencyKey: optionalTrimmedString,
  email: optionalTrimmedString,
  baseCurrency: optionalTrimmedString,
  quoteCurrency: optionalTrimmedString,
  walletAddress: optionalTrimmedString,
  sourceObjectId: optionalTrimmedString,
});

const dashboardOverviewQuerySchema = z.object({
  range: dashboardOverviewRangeSchema.optional().default(defaultDashboardRecapRange),
  from: optionalDateStringSchema,
  to: optionalDateStringSchema,
});

const dashboardTransactionsQuerySchema = z.object({
  search: optionalTrimmedString,
  page: z.coerce.number().int().positive().optional().default(1),
});

const parseOrThrow = <T>(
  result: { success: true; data: T } | { success: false; error: z.ZodError },
  fallbackMessage: string
) => {
  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message ?? fallbackMessage);
  }

  return result.data;
};

const normalizeQuery = (query: ParsedUrlQuery) =>
  Object.fromEntries(Object.entries(query).map(([key, value]) => [key, getSingleQueryValue(value)]));

export const parseDashboardOverviewQuery = (query: ParsedUrlQuery): {
  range: DashboardRecapRange | "24h" | "30d";
  from?: string;
  to?: string;
} =>
  parseOrThrow(dashboardOverviewQuerySchema.safeParse(normalizeQuery(query)), "Invalid overview filters.");

export const parseDashboardTransactionsQuery = (query: ParsedUrlQuery) =>
  parseOrThrow(
    dashboardTransactionsQuerySchema.safeParse(normalizeQuery(query)),
    "Invalid transaction filters."
  );

export const parseDashboardSettingsBody = (body: unknown) =>
  parseOrThrow(
    dashboardSettingsBodySchema.safeParse(parseJsonBody(body)),
    "Invalid dashboard settings payload."
  );

export const parseReconcileRequestBody = (body: unknown) =>
  parseOrThrow(reconcileRequestSchema.safeParse(parseJsonBody(body)), "Invalid reconcile payload.");

export const parseMoonPaySignUrlBody = (body: unknown) =>
  parseOrThrow(
    moonPaySignUrlBodySchema.safeParse(parseJsonBody(body)),
    "Invalid MoonPay signing payload."
  );

export type DashboardSettingsBody = PaymentAppSettingsInput;
export type DashboardTransactionsQuery = z.infer<typeof dashboardTransactionsQuerySchema>;
export type DashboardOverviewQuery = {
  range: DashboardRecapRange | "24h" | "30d";
  from?: string;
  to?: string;
};
export type ReconcileRequestBody = z.infer<typeof reconcileRequestSchema>;
export type MoonPaySignUrlBody = z.infer<typeof moonPaySignUrlBodySchema>;
export type CountryRestrictionMode = PaymentCountryRestrictionMode;
export type PaymentProvider = PaymentProviderKey;
