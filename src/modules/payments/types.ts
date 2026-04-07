export type PaymentProviderKey = "nowpayments" | "moonpay" | "rampnetwork";

export type UsdQuoteMetadata = {
  sourceAmount: number;
  sourceCurrency: string;
  displayCurrency: string;
  displayAmountUsd: number;
  providerCurrency: string;
  providerAmount: number;
  fxRate: number;
  fxProvider: string;
  fxTimestamp: string;
};

export type SaleorPaymentStatus =
  | "ACTION_REQUIRED"
  | "PENDING"
  | "SUCCESS"
  | "AUTHORIZED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED"
  | "UNKNOWN";

export type FinalizationState = "pending" | "finalized";

export type SaleorActionType = "CHARGE" | "AUTHORIZATION";

export type PaymentSessionSourceObjectType = "CHECKOUT" | "ORDER";

export type ComplianceContract = {
  waiverAccepted: boolean;
  waiverAcceptedAt: string;
  waiverTextVersion: string;
  complianceRecordId: string;
  signatureMode: "CLICKWRAP" | "ZOHO_SIGN";
  typedFullName?: string | null;
  signatureCompleted?: boolean | null;
  waiverStatus?: string | null;
  ipAddressLoggedByComplianceApp?: string | null;
  isPaymentAllowed?: boolean | null;
  reason?: string | null;
  adminReason?: string | null;
  nextAction?: string | null;
};

export type PaymentGatewayData = {
  provider?: string;
  paymentProvider?: string;
  gateway?: string;
  compliance?: Partial<ComplianceContract>;
  walletAddress?: string;
  email?: string;
  quoteCurrency?: string;
  baseCurrency?: string;
  asset?: string;
  fiatCurrency?: string;
  fiatValue?: string;
  displayCurrency?: string;
  displayAmountUsd?: number;
  providerCurrency?: string;
  providerAmount?: number;
  fxRate?: number;
  fxProvider?: string;
  fxTimestamp?: string;
  providerData?: Record<string, unknown>;
};

export type PaymentSessionRecord = {
  id: string;
  saleorApiUrl: string;
  saleorTransactionId: string;
  saleorTransactionToken?: string | null;
  saleorPspReference?: string | null;
  saleorMerchantReference: string;
  saleorSourceObjectType: PaymentSessionSourceObjectType;
  saleorSourceObjectId: string;
  checkoutId?: string | null;
  orderId?: string | null;
  customerEmail?: string | null;
  channelSlug?: string | null;
  provider: PaymentProviderKey;
  providerPaymentId?: string | null;
  providerInvoiceId?: string | null;
  providerReferenceId?: string | null;
  providerStatus: string;
  saleorStatus: SaleorPaymentStatus;
  amount: string;
  currency: string;
  hostedUrl?: string | null;
  redirectUrl?: string | null;
  idempotencyKey: string;
  lastWebhookPayload?: unknown;
  complianceContract?: ComplianceContract | null;
  safeErrorSummary?: string | null;
  statusReason?: string | null;
  finalizationState: FinalizationState;
  createdAt: Date;
  updatedAt: Date;
  processedAt?: Date | null;
};

export type ProviderValidationResult = {
  isConfigured: boolean;
  missingFields: string[];
  summary: string;
};

export type ProviderDashboardStatus = ProviderValidationResult & {
  provider: PaymentProviderKey;
  enabled: boolean;
  environment: string;
};

export type ProviderInitializeInput = {
  saleorApiUrl: string;
  amount: number;
  currency: string;
  merchantReference: string;
  transactionId: string;
  idempotencyKey: string;
  customerIpAddress?: string | null;
  customerEmail?: string | null;
  baseUrl: string;
  gatewayData: PaymentGatewayData;
  providerCurrency?: string;
  providerAmount?: number;
  fxQuote?: UsdQuoteMetadata | null;
  sourceObjectId: string;
  sourceObjectType: PaymentSessionSourceObjectType;
};

export type ProviderStatusResult = {
  providerStatus: string;
  saleorStatus: SaleorPaymentStatus;
  hostedUrl?: string | null;
  redirectUrl?: string | null;
  providerPaymentId?: string | null;
  providerInvoiceId?: string | null;
  providerReferenceId?: string | null;
  message?: string | null;
  rawResponse?: unknown;
  providerCurrency?: string | null;
  providerAmount?: number | null;
  fxQuote?: UsdQuoteMetadata | null;
  finalizationState: FinalizationState;
};

export type ProviderWebhookResult = ProviderStatusResult & {
  externalEventId: string;
};

export type PaymentProvider = {
  readonly key: PaymentProviderKey;
  validateConfig(): ProviderValidationResult;
  getDashboardStatus(): ProviderDashboardStatus;
  initializeSession(input: ProviderInitializeInput): Promise<ProviderStatusResult>;
  processSession(session: PaymentSessionRecord): Promise<ProviderStatusResult>;
  getStatus(session: PaymentSessionRecord): Promise<ProviderStatusResult>;
  handleWebhook(input: {
    headers: Headers;
    rawBody: string;
    payload: unknown;
    baseUrl: string;
  }): Promise<ProviderWebhookResult>;
};
