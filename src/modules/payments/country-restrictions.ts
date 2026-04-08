import type {
  PaymentCountryRestrictionConfig,
  PaymentCountryRestrictionMode,
} from "@/modules/payments/types";
import type { SaleorSourceObject } from "@/modules/saleor/types";

const supportedModes = new Set<PaymentCountryRestrictionMode>([
  "allow_all",
  "allow_list",
  "block_list",
]);

const isIsoCountryCode = (value: string) => /^[A-Z]{2}$/.test(value);

export const defaultPaymentCountryRestrictions: PaymentCountryRestrictionConfig = {
  version: 1,
  mode: "allow_list",
  countries: ["TH"],
  addressSource: "shipping_then_billing",
};

export const normalizeCountryCode = (value: string) => value.trim().toUpperCase();

export const normalizeCountryCodes = (values: Iterable<string>) => {
  const normalized = Array.from(values, normalizeCountryCode).filter(isIsoCountryCode);
  return Array.from(new Set(normalized));
};

export const parseCountryCodesInput = (value: string) =>
  normalizeCountryCodes(value.split(/[,\s]+/).filter(Boolean));

export const stringifyCountryCodes = (values: Iterable<string>) => normalizeCountryCodes(values).join(", ");

export const normalizePaymentCountryRestrictions = (
  value?: Partial<PaymentCountryRestrictionConfig> | null
): PaymentCountryRestrictionConfig => {
  const mode = value?.mode && supportedModes.has(value.mode) ? value.mode : defaultPaymentCountryRestrictions.mode;

  return {
    version: 1,
    mode,
    countries: normalizeCountryCodes(value?.countries ?? defaultPaymentCountryRestrictions.countries),
    addressSource: "shipping_then_billing",
  };
};

export const resolveSourceObjectCountryCode = (sourceObject: SaleorSourceObject) => {
  const shippingCountry = sourceObject.shippingAddress?.country.code;
  if (shippingCountry) {
    return normalizeCountryCode(shippingCountry);
  }

  const billingCountry = sourceObject.billingAddress?.country.code;
  if (billingCountry) {
    return normalizeCountryCode(billingCountry);
  }

  return null;
};

export const isCountryAllowedByRestrictions = (
  restrictions: PaymentCountryRestrictionConfig,
  countryCode: string | null
) => {
  if (restrictions.mode === "allow_all") {
    return true;
  }

  if (!countryCode) {
    return false;
  }

  const normalizedCountry = normalizeCountryCode(countryCode);
  const countries = normalizeCountryCodes(restrictions.countries);
  const matches = countries.includes(normalizedCountry);

  if (restrictions.mode === "allow_list") {
    return matches;
  }

  return !matches;
};
