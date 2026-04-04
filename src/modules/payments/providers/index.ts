import { getEnv } from "@/modules/config/env";
import { UnsupportedProviderError } from "@/modules/core/errors";
import { PaymentProvider, PaymentProviderKey } from "@/modules/payments/types";

import { MoonPayProvider } from "./moonpay";
import { NowPaymentsProvider } from "./nowpayments";
import { RampNetworkProvider } from "./rampnetwork";

const providerRegistry: Record<PaymentProviderKey, PaymentProvider> = {
  nowpayments: new NowPaymentsProvider(),
  moonpay: new MoonPayProvider(),
  rampnetwork: new RampNetworkProvider(),
};

export const getProvider = (provider: string): PaymentProvider => {
  if (provider !== "nowpayments" && provider !== "moonpay" && provider !== "rampnetwork") {
    throw new UnsupportedProviderError(provider);
  }

  return providerRegistry[provider];
};

export const getAvailableProviders = () => Object.values(providerRegistry);

export const getDefaultProvider = () => getProvider(getEnv().defaultPaymentProvider);
