import { ProviderConfigError } from "@/modules/core/errors";
import { PaymentGatewayData, PaymentProviderKey } from "@/modules/payments/types";

export const resolveProviderKey = (
  gatewayData: PaymentGatewayData,
  settings: {
    defaultProvider: string;
    nowpaymentsEnabled: boolean;
    moonpayEnabled: boolean;
    rampnetworkEnabled: boolean;
  }
): PaymentProviderKey => {
  const explicitProvider = gatewayData.provider ?? gatewayData.paymentProvider ?? gatewayData.gateway;
  const selectedProvider = (explicitProvider ?? settings.defaultProvider) as PaymentProviderKey;

  if (selectedProvider === "nowpayments" && !settings.nowpaymentsEnabled) {
    throw new ProviderConfigError("NOWPayments is disabled for this Saleor app installation.");
  }

  if (selectedProvider === "moonpay" && !settings.moonpayEnabled) {
    throw new ProviderConfigError("MoonPay is disabled for this Saleor app installation.");
  }

  if (selectedProvider === "rampnetwork" && !settings.rampnetworkEnabled) {
    throw new ProviderConfigError("Ramp Network is disabled for this Saleor app installation.");
  }

  return selectedProvider;
};
