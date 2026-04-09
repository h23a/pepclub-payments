import { actions, useAppBridge, useAuthenticatedFetch } from "@saleor/app-sdk/app-bridge";
import {
  Box,
  Button,
  Checkbox,
  ChervonDownIcon,
  ChervonUpIcon,
  Chip,
  ExternalLinkIcon,
  SearchInput,
  Text,
} from "@saleor/macaw-ui";
import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  defaultPaymentCountryRestrictions,
  parseCountryCodesInput,
  stringifyCountryCodes,
} from "@/modules/payments/country-restrictions";

type OverviewResponse = {
  connection: {
    installed: boolean;
    saleorApiUrl: string;
    appId: string;
    environment: string;
  };
  settings: {
    defaultProvider: "nowpayments" | "moonpay" | "rampnetwork";
    nowpaymentsEnabled: boolean;
    moonpayEnabled: boolean;
    rampnetworkEnabled: boolean;
    countryRestrictions: {
      version: 1;
      mode: "allow_all" | "allow_list" | "block_list";
      countries: string[];
      addressSource: "shipping_only";
    };
  };
  providers: Array<{
    provider: "nowpayments" | "moonpay" | "rampnetwork";
    enabled: boolean;
    environment: string;
    isConfigured: boolean;
    summary: string;
    missingFields: string[];
  }>;
  stats: {
    recentTransactionCount: number;
    recentWebhookCount: number;
    latestWebhook?: {
      providerStatus?: string | null;
      createdAt: string;
    } | null;
    lastSafeErrorSummary?: string | null;
  };
  paymentRecap: {
    range: "today" | "7d" | "month" | "custom";
    from: string;
    to: string;
    transactionCount: number;
    successCount: number;
    failedCount: number;
    pendingCount: number;
    resolvedTransactionCount: number;
    amountsByCurrency: Array<{
      currency: string;
      successAmount: number;
      failedAmount: number;
      pendingAmount: number;
    }>;
    webhookCount: number;
    successRate: number | null;
    latestWebhook?: {
      providerStatus?: string | null;
      createdAt: string;
    } | null;
    lastSafeErrorSummary?: string | null;
  };
  warnings: string[];
  recentTransactions: Array<{
    id: string;
    saleorTransactionId: string;
    provider: string;
    saleorStatus: string;
    providerStatus: string;
    providerReferenceId?: string | null;
    hostedUrl?: string | null;
    redirectUrl?: string | null;
    updatedAt: string;
  }>;
  secrets: Record<string, string>;
};

type DiagnosticsResponse = {
  database: {
    ok: boolean;
    error?: string;
  };
  apl: {
    configured: boolean;
    saleorApiUrl: string;
    appId: string;
  };
  providerConfig: Array<{
    provider: string;
    enabled: boolean;
    environment: string;
    isConfigured: boolean;
    summary: string;
    missingFields: string[];
  }>;
  latestWebhook?: {
    providerStatus?: string | null;
    createdAt: string;
  } | null;
  lastSafeErrorSummary?: string | null;
};

type TransactionLookupItem = {
  session: {
    id: string;
    saleorTransactionId: string;
    provider: string;
    providerStatus: string;
    saleorStatus: string;
    providerReferenceId?: string | null;
    providerPaymentId?: string | null;
    providerInvoiceId?: string | null;
    hostedUrl?: string | null;
    redirectUrl?: string | null;
    safeErrorSummary?: string | null;
    lastWebhookPayload?: unknown;
    updatedAt: string;
  };
  timeline: Array<{
    id: string;
    eventType: string;
    providerStatus?: string | null;
    saleorStatus?: string | null;
    createdAt: string;
  }>;
};

type TransactionLookupResponse = {
  items: TransactionLookupItem[];
  page: number;
  pageSize: number;
  totalCount: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};

const formatDate = (value?: string | null) => {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

const formatRelativeTime = (value?: string | null) => {
  if (!value) {
    return "Never";
  }

  const target = new Date(value).getTime();
  const now = Date.now();

  if (Number.isNaN(target)) {
    return "Unknown";
  }

  const diffInMinutes = Math.round((target - now) / (1000 * 60));
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (Math.abs(diffInMinutes) < 60) {
    return formatter.format(diffInMinutes, "minute");
  }

  const diffInHours = Math.round(diffInMinutes / 60);

  if (Math.abs(diffInHours) < 24) {
    return formatter.format(diffInHours, "hour");
  }

  const diffInDays = Math.round(diffInHours / 24);
  return formatter.format(diffInDays, "day");
};

const formatPercent = (value?: number | null) => {
  if (value === null || value === undefined) {
    return "N/A";
  }

  return `${value.toFixed(1)}%`;
};

const formatDateOnly = (value?: string | null) => {
  if (!value) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value));
};

const formatDateInputValue = (value: Date) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const formatCurrencyAmount = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
};

const getPresetDateRange = (range: "today" | "7d" | "month", now = new Date()) => {
  const end = formatDateInputValue(now);
  const start = new Date(now);

  if (range === "today") {
    return { from: end, to: end };
  }

  if (range === "month") {
    start.setDate(1);
    return {
      from: formatDateInputValue(start),
      to: end,
    };
  }

  start.setDate(start.getDate() - 6);

  return {
    from: formatDateInputValue(start),
    to: end,
  };
};

const getRecapRangeLabel = (
  range: OverviewResponse["paymentRecap"]["range"],
  from?: string,
  to?: string,
) => {
  if (range === "today") {
    return "Today";
  }

  if (range === "month") {
    return "This Month";
  }

  if (range === "custom") {
    return `${formatDateOnly(from)} - ${formatDateOnly(to)}`;
  }

  return "Last 7 Days";
};

const prettyJson = (value: unknown) => JSON.stringify(value ?? {}, null, 2);

const providerOrder = ["rampnetwork", "moonpay", "nowpayments"] as const;
const recapRanges = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 Days" },
  { id: "month", label: "This Month" },
] as const;

type RecapFilterState = {
  range: OverviewResponse["paymentRecap"]["range"];
  from: string;
  to: string;
};

const emptyTransactionsResponse: TransactionLookupResponse = {
  items: [],
  page: 1,
  pageSize: 20,
  totalCount: 0,
  hasPreviousPage: false,
  hasNextPage: false,
};

const sections = [
  { id: "overview", label: "Overview" },
  { id: "providers", label: "Providers" },
  { id: "transactions", label: "Transactions" },
  { id: "diagnostics", label: "Diagnostics" },
] as const;

const classNames = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

const getChipTone = (value: string) => {
  const normalized = value.toLowerCase();

  if (
    normalized.includes("failed") ||
    normalized.includes("reject") ||
    normalized.includes("error") ||
    normalized.includes("expired") ||
    normalized.includes("cancel") ||
    normalized.includes("refund")
  ) {
    return "isCritical";
  }

  if (
    normalized.includes("pending") ||
    normalized.includes("processing") ||
    normalized.includes("waiting") ||
    normalized.includes("confirm") ||
    normalized.includes("review") ||
    normalized.includes("action_required") ||
    normalized.includes("action required")
  ) {
    return "isInfo";
  }

  if (
    normalized.includes("issue") ||
    normalized.includes("warn") ||
    normalized.includes("missing") ||
    normalized.includes("disabled") ||
    normalized.includes("needs") ||
    normalized.includes("attention") ||
    normalized.includes("not ")
  ) {
    return "isWarn";
  }

  if (
    normalized.includes("ready") ||
    normalized.includes("connected") ||
    normalized.includes("configured") ||
    normalized.includes("installed") ||
    normalized.includes("saved") ||
    normalized.includes("reconciled")
  ) {
    return "isSuccess";
  }

  return "";
};

const StatusChip = ({ children }: { children: string }) => (
  <Chip className={classNames("statusChip", getChipTone(children))}>{children}</Chip>
);

const getProviderBadgeTone = (provider: string) => {
  const normalized = provider.toLowerCase();

  if (normalized === "moonpay") {
    return "isMoonpay";
  }

  if (normalized === "rampnetwork") {
    return "isRampnetwork";
  }

  if (normalized === "nowpayments") {
    return "isNowpayments";
  }

  return "";
};

const formatProviderLabel = (provider: string) => {
  const normalized = provider.toLowerCase();

  if (normalized === "moonpay") {
    return "MoonPay";
  }

  if (normalized === "rampnetwork") {
    return "Ramp Network";
  }

  if (normalized === "nowpayments") {
    return "NOWPayments";
  }

  return provider;
};

const ProviderChip = ({ provider }: { provider: string }) => (
  <Chip className={classNames("statusChip", "providerChip", getProviderBadgeTone(provider))}>
    {formatProviderLabel(provider)}
  </Chip>
);

const SyncIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="buttonIconSvg">
    <path
      d="M15.833 8.333A6.667 6.667 0 0 0 4.38 5.254M4.167 11.667a6.667 6.667 0 0 0 11.453 3.08"
      stroke="currentColor"
      strokeWidth="1.67"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M15.833 3.333v5H10.833M9.167 11.667h-5v5"
      stroke="currentColor"
      strokeWidth="1.67"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const getProviderReferenceMeta = (session: TransactionLookupItem["session"]) => {
  if (session.providerReferenceId) {
    return {
      label: "Reference ID",
      value: session.providerReferenceId,
    };
  }

  if (session.providerPaymentId) {
    return {
      label: "Payment ID",
      value: session.providerPaymentId,
    };
  }

  if (session.providerInvoiceId) {
    return {
      label: "Invoice ID",
      value: session.providerInvoiceId,
    };
  }

  return {
    label: "Reference",
    value: "Not assigned yet",
  };
};

const shortenIdentifier = (value: string, maxLength = 24) => {
  if (value.length <= maxLength) {
    return value;
  }

  const edgeLength = Math.max(6, Math.floor((maxLength - 1) / 2));
  return `${value.slice(0, edgeLength)}…${value.slice(-edgeLength)}`;
};

const transactionIdPreviewLength = 22;
const sessionIdPreviewLength = 18;

const SectionHeader = ({ title, description }: { description?: string; title: string }) => (
  <Box className="titleBlock tight">
    <Text size={7} as="h2" className="headingText">
      {title}
    </Text>
    {description ? (
      <Text as="p" color="default2" className="mutedText">
        {description}
      </Text>
    ) : null}
  </Box>
);

const sortProviders = <T extends { provider: (typeof providerOrder)[number] }>(providers: T[]) =>
  [...providers].sort(
    (left, right) => providerOrder.indexOf(left.provider) - providerOrder.indexOf(right.provider),
  );

export const DashboardPage = () => {
  const authenticatedFetch = useAuthenticatedFetch();
  const { appBridge, appBridgeState } = useAppBridge();
  const [section, setSection] = useState<(typeof sections)[number]["id"]>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResponse | null>(null);
  const [transactions, setTransactions] =
    useState<TransactionLookupResponse>(emptyTransactionsResponse);
  const [search, setSearch] = useState("");
  const [appliedTransactionSearch, setAppliedTransactionSearch] = useState("");
  const [transactionPage, setTransactionPage] = useState(1);
  const [draftRecapFilter, setDraftRecapFilter] = useState<RecapFilterState>(() => ({
    range: "7d",
    ...getPresetDateRange("7d"),
  }));
  const [appliedRecapFilter, setAppliedRecapFilter] = useState<RecapFilterState>(() => ({
    range: "7d",
    ...getPresetDateRange("7d"),
  }));
  const [draftSettings, setDraftSettings] = useState({
    defaultProvider: "nowpayments" as "nowpayments" | "moonpay" | "rampnetwork",
    nowpaymentsEnabled: true,
    moonpayEnabled: true,
    rampnetworkEnabled: true,
    countryRestrictions: {
      ...defaultPaymentCountryRestrictions,
      countries: [...defaultPaymentCountryRestrictions.countries],
    },
  });
  const [countryRestrictionsInput, setCountryRestrictionsInput] = useState(() =>
    stringifyCountryCodes(defaultPaymentCountryRestrictions.countries),
  );
  const [savingSettings, setSavingSettings] = useState(false);
  const [reconcilingTransactionId, setReconcilingTransactionId] = useState<string | null>(null);
  const [expandedTransactionId, setExpandedTransactionId] = useState<string | null>(null);

  const isEmbedded = Boolean(
    appBridgeState?.ready && appBridgeState.saleorApiUrl && appBridgeState.token,
  );

  const fetchAppApi = async <T,>(
    path: string,
    init?: {
      method?: "GET" | "POST";
      body?: Record<string, unknown>;
    },
  ) => {
    const response = await authenticatedFetch(path, {
      method: init?.method ?? "GET",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    const payload = (await response.json()) as T & {
      code?: string;
      error?: string;
      message?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? payload.message ?? "Request failed.");
    }

    return payload;
  };

  const openExternal = (url: string) => {
    if (!url) {
      return;
    }

    if (appBridgeState?.ready) {
      appBridge?.dispatch(
        actions.Redirect({
          to: url,
          newContext: true,
        }),
      );
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  };

  const buildOverviewPath = () => {
    const params = new URLSearchParams();
    params.set("range", appliedRecapFilter.range);

    if (appliedRecapFilter.range === "custom") {
      const from = new Date(`${appliedRecapFilter.from}T00:00:00`);
      const to = new Date(`${appliedRecapFilter.to}T23:59:59.999`);

      params.set("from", from.toISOString());
      params.set("to", to.toISOString());
    }

    return `/api/dashboard/overview?${params.toString()}`;
  };

  const buildTransactionsPath = (transactionSearch?: string, page = 1) => {
    const params = new URLSearchParams();

    if (transactionSearch?.trim()) {
      params.set("search", transactionSearch.trim());
    }

    params.set("page", String(page));

    return `/api/dashboard/transactions?${params.toString()}`;
  };

  const loadDashboard = async (options?: {
    transactionSearch?: string;
    transactionPage?: number;
  }) => {
    if (!isEmbedded) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const overviewPath = buildOverviewPath();
      const transactionsPath = buildTransactionsPath(
        options?.transactionSearch ?? appliedTransactionSearch,
        options?.transactionPage ?? transactionPage,
      );
      const [overviewResponse, diagnosticsResponse, transactionsResponse] = await Promise.all([
        fetchAppApi<OverviewResponse>(overviewPath),
        fetchAppApi<DiagnosticsResponse>("/api/dashboard/diagnostics"),
        fetchAppApi<TransactionLookupResponse>(transactionsPath),
      ]);

      setOverview(overviewResponse);
      setDiagnostics(diagnosticsResponse);
      setTransactions(transactionsResponse);
      setExpandedTransactionId(null);
      setDraftSettings({
        defaultProvider: overviewResponse.settings.defaultProvider,
        nowpaymentsEnabled: overviewResponse.settings.nowpaymentsEnabled,
        moonpayEnabled: overviewResponse.settings.moonpayEnabled,
        rampnetworkEnabled: overviewResponse.settings.rampnetworkEnabled,
        countryRestrictions: overviewResponse.settings.countryRestrictions,
      });
      setCountryRestrictionsInput(
        stringifyCountryCodes(overviewResponse.settings.countryRestrictions.countries),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load app data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isEmbedded,
    appBridgeState?.saleorApiUrl,
    appBridgeState?.token,
    appliedRecapFilter.range,
    appliedRecapFilter.from,
    appliedRecapFilter.to,
  ]);

  const providerStatusByKey = useMemo(
    () => new Map(overview?.providers.map((provider) => [provider.provider, provider]) ?? []),
    [overview?.providers],
  );

  const orderedProviders = useMemo(
    () => sortProviders(overview?.providers ?? []),
    [overview?.providers],
  );

  const orderedDiagnosticsProviders = useMemo(
    () =>
      sortProviders(
        (diagnostics?.providerConfig ?? []).filter(
          (
            provider,
          ): provider is DiagnosticsResponse["providerConfig"][number] & {
            provider: (typeof providerOrder)[number];
          } => providerOrder.includes(provider.provider as (typeof providerOrder)[number]),
        ),
      ),
    [diagnostics?.providerConfig],
  );

  const enabledProviders = useMemo(
    () =>
      orderedProviders
        .filter((provider) => provider.enabled)
        .map((provider) => provider.provider)
        .join(", ") || "None",
    [orderedProviders],
  );

  const summaryCards = useMemo(
    () => [
      {
        label: "Payment success rate",
        value: formatPercent(overview?.paymentRecap.successRate),
      },
      {
        label: "Failed payments",
        value: String(overview?.paymentRecap.failedCount ?? 0),
      },
      {
        label: "Transactions in range",
        value: String(overview?.paymentRecap.transactionCount ?? 0),
      },
      {
        label: "Provider webhooks",
        value: String(overview?.paymentRecap.webhookCount ?? 0),
      },
    ],
    [overview],
  );
  const activeRecapRangeLabel = getRecapRangeLabel(
    overview?.paymentRecap.range ?? appliedRecapFilter.range,
    overview?.paymentRecap.from,
    overview?.paymentRecap.to,
  );
  const transactionsRangeLabel =
    transactions.totalCount === 0
      ? "Showing 0 results"
      : `Showing ${(transactions.page - 1) * transactions.pageSize + 1}-${Math.min(
          transactions.page * transactions.pageSize,
          transactions.totalCount,
        )} of ${transactions.totalCount}`;
  const isCustomDraftRangeValid =
    Boolean(draftRecapFilter.from) &&
    Boolean(draftRecapFilter.to) &&
    new Date(draftRecapFilter.from).getTime() <= new Date(draftRecapFilter.to).getTime();

  const handleSettingsSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSavingSettings(true);
    setNotice(null);
    setError(null);

    try {
      const nextCountryRestrictions = {
        ...draftSettings.countryRestrictions,
        countries: parseCountryCodesInput(countryRestrictionsInput),
      } as const;

      await fetchAppApi("/api/dashboard/settings", {
        method: "POST",
        body: {
          ...draftSettings,
          countryRestrictions: nextCountryRestrictions,
        },
      });
      setNotice("Settings saved.");
      await loadDashboard({
        transactionSearch: appliedTransactionSearch,
        transactionPage,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save settings.");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTransactionSearch = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedSearch = search.trim();

    setAppliedTransactionSearch(normalizedSearch);
    setTransactionPage(1);
    setNotice(null);
    setError(null);
    await loadDashboard({
      transactionSearch: normalizedSearch,
      transactionPage: 1,
    });
  };

  const handleTransactionSearchReset = async () => {
    setSearch("");
    setAppliedTransactionSearch("");
    setTransactionPage(1);
    setNotice(null);
    setError(null);
    await loadDashboard({
      transactionSearch: "",
      transactionPage: 1,
    });
  };

  const handleShortcutRecapRange = (range: (typeof recapRanges)[number]["id"]) => {
    const nextFilter = {
      range,
      ...getPresetDateRange(range),
    } satisfies RecapFilterState;

    setDraftRecapFilter(nextFilter);
    setAppliedRecapFilter(nextFilter);
    setError(null);
  };

  const handleCustomDateApply = () => {
    if (!isCustomDraftRangeValid) {
      setError("Choose a valid custom date range before applying it.");
      return;
    }

    setAppliedRecapFilter({
      range: "custom",
      from: draftRecapFilter.from,
      to: draftRecapFilter.to,
    });
    setError(null);
  };

  const handleTransactionsPageChange = async (nextPage: number) => {
    setTransactionPage(nextPage);
    await loadDashboard({
      transactionSearch: appliedTransactionSearch,
      transactionPage: nextPage,
    });
  };

  const handleReconcile = async (saleorTransactionId: string) => {
    setReconcilingTransactionId(saleorTransactionId);
    setNotice(null);
    setError(null);

    try {
      await fetchAppApi("/api/dashboard/reconcile", {
        method: "POST",
        body: {
          saleorTransactionId,
        },
      });
      setNotice(`Synced ${saleorTransactionId} from provider.`);
      await loadDashboard({
        transactionSearch: appliedTransactionSearch,
        transactionPage,
      });
    } catch (reconcileError) {
      setError(
        reconcileError instanceof Error ? reconcileError.message : "Could not sync from provider.",
      );
    } finally {
      setReconcilingTransactionId(null);
    }
  };

  if (!isEmbedded) {
    return null;
  }

  return (
    <Box className="dashboardPage">
      <Box className="pageHeader">
        <Box className="titleBlock">
          <Text size={11} className="pageTitle">
            Pepclub Payments
          </Text>
          <Text as="p" color="default2" className="mutedText">
            Hosted/offsite payment orchestration for NOWPayments, MoonPay, and Ramp Network.
          </Text>
        </Box>
        <Box className="statusRow">
          <StatusChip>{overview?.connection.environment ?? "loading"}</StatusChip>
        </Box>
      </Box>

      {loading && <Box className="appCard">Loading operational data…</Box>}
      {!loading && error && <Box className="appCard noticeCard isError">{error}</Box>}
      {!loading && notice && <Box className="appCard noticeCard isSuccess">{notice}</Box>}

      {!loading && overview && (
        <>
          <Box className="sectionTabs">
            {sections.map((item) => (
              <Button
                key={item.id}
                variant="secondary"
                className={classNames("sectionButton", section === item.id && "isActive")}
                onClick={() => setSection(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </Box>

          {section === "overview" ? (
            <Box className="stackLarge">
              <Box className="appCard heroPanel">
                <Box className="heroHeader">
                  <Box className="titleBlock">
                    <Text size={2} as="span" className="heroEyebrow">
                      Payment Operations
                    </Text>
                    <Text as="p" color="default2" className="mutedText">
                      Activity window: {activeRecapRangeLabel}
                    </Text>
                  </Box>
                  <Box className="statusRow">
                    <StatusChip>
                      {diagnostics?.database.ok
                        ? "Database connected"
                        : "Database attention needed"}
                    </StatusChip>
                    <StatusChip>{overview.connection.environment}</StatusChip>
                    <StatusChip>
                      {overview.connection.installed ? "Installed in Saleor" : "Not installed"}
                    </StatusChip>
                  </Box>
                </Box>

                <Box className="sectionTabs">
                  {recapRanges.map((item) => (
                    <Button
                      key={item.id}
                      variant="secondary"
                      className={classNames(
                        "sectionButton",
                        overview.paymentRecap.range === item.id && "isActive",
                      )}
                      onClick={() => handleShortcutRecapRange(item.id)}
                    >
                      {item.label}
                    </Button>
                  ))}
                </Box>

                <Box className="dateRangePanel">
                  <label className="fieldLabel">
                    Start date
                    <input
                      type="date"
                      className="selectInput"
                      value={draftRecapFilter.from}
                      onChange={(event) =>
                        setDraftRecapFilter((current) => ({
                          ...current,
                          range: "custom",
                          from: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="fieldLabel">
                    End date
                    <input
                      type="date"
                      className="selectInput"
                      value={draftRecapFilter.to}
                      onChange={(event) =>
                        setDraftRecapFilter((current) => ({
                          ...current,
                          range: "custom",
                          to: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <Box className="actionsRow end dateRangeApplyRow">
                    <Button
                      variant="secondary"
                      className="applyCustomRangeButton"
                      onClick={handleCustomDateApply}
                      disabled={!isCustomDraftRangeValid || loading}
                    >
                      Apply custom range
                    </Button>
                  </Box>
                </Box>

                <Box className="summaryGrid">
                  {summaryCards.map((item) => (
                    <Box key={item.label} className="summaryCard">
                      <Text as="p" color="default2" className="mutedText">
                        {item.label}
                      </Text>
                      <Text size={8} className="summaryValue">
                        {item.value}
                      </Text>
                    </Box>
                  ))}
                </Box>
              </Box>

              <Box className="appCard">
                <SectionHeader
                  title="Amount by status"
                  description="Success shows revenue received. Failed and pending show attempted amount totals grouped by currency."
                />
                {overview.paymentRecap.amountsByCurrency.length === 0 ? (
                  <Box className="emptyState">
                    <Text as="p" className="bodyText">
                      No payment amounts found in the selected date range.
                    </Text>
                  </Box>
                ) : (
                  <Box className="fieldGrid">
                    {overview.paymentRecap.amountsByCurrency.map((entry) => (
                      <Box key={entry.currency} className="miniCard">
                        <Text className="labelText">{entry.currency}</Text>
                        <dl className="definitionList compact">
                          <div>
                            <dt>Success revenue</dt>
                            <dd>{formatCurrencyAmount(entry.successAmount, entry.currency)}</dd>
                          </div>
                          <div>
                            <dt>Failed attempted</dt>
                            <dd>{formatCurrencyAmount(entry.failedAmount, entry.currency)}</dd>
                          </div>
                          <div>
                            <dt>Pending attempted</dt>
                            <dd>{formatCurrencyAmount(entry.pendingAmount, entry.currency)}</dd>
                          </div>
                        </dl>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>

              <Box className="cardGrid">
                <Box className="appCard">
                  <SectionHeader title="Connection snapshot" />
                  <dl className="definitionList">
                    <div>
                      <dt>Saleor API</dt>
                      <dd>{overview.connection.saleorApiUrl}</dd>
                    </div>
                    <div>
                      <dt>App connection</dt>
                      <dd>{overview.connection.installed ? "Installed" : "Not installed"}</dd>
                    </div>
                    <div>
                      <dt>Enabled providers</dt>
                      <dd>{enabledProviders}</dd>
                    </div>
                    <div>
                      <dt>Environment</dt>
                      <dd>{overview.connection.environment}</dd>
                    </div>
                  </dl>
                </Box>

                <Box className="appCard">
                  <SectionHeader title="Routing snapshot" />
                  <dl className="definitionList">
                    <div>
                      <dt>Fallback provider</dt>
                      <dd>{overview.settings.defaultProvider}</dd>
                    </div>
                    <div>
                      <dt>MoonPay key</dt>
                      <dd>{overview.secrets.moonpayPublishableKey}</dd>
                    </div>
                    <div>
                      <dt>NOWPayments key</dt>
                      <dd>{overview.secrets.nowpaymentsApiKey}</dd>
                    </div>
                    <div>
                      <dt>Ramp key</dt>
                      <dd>{overview.secrets.rampnetworkApiKey}</dd>
                    </div>
                  </dl>
                </Box>

                <Box className="appCard">
                  <SectionHeader title="Recent activity" />
                  <dl className="definitionList">
                    <div>
                      <dt>Selected window</dt>
                      <dd>{activeRecapRangeLabel}</dd>
                    </div>
                    <div>
                      <dt>Pending / awaiting finalization</dt>
                      <dd>{overview.paymentRecap.pendingCount}</dd>
                    </div>
                    <div>
                      <dt>Latest provider event</dt>
                      <dd>{formatDate(overview.paymentRecap.latestWebhook?.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>Latest provider status</dt>
                      <dd>
                        {overview.paymentRecap.latestWebhook?.providerStatus ?? "None in range"}
                      </dd>
                    </div>
                    <div>
                      <dt>Latest payment issue</dt>
                      <dd>{overview.paymentRecap.lastSafeErrorSummary ?? "None recorded"}</dd>
                    </div>
                  </dl>
                </Box>
              </Box>
            </Box>
          ) : null}

          {section === "providers" ? (
            <Box className="stackLarge">
              <Box as="form" className="appCard formCard" onSubmit={handleSettingsSubmit}>
                <SectionHeader
                  title="Provider settings"
                  description="Runtime toggles are stored per Saleor installation. Secrets stay env-backed and are never shown after save."
                />

                <Box className="providerSettingsSplit">
                  <Box className="providerSettingsColumn">
                    <Text as="p" className="labelText">
                      Enabled providers
                    </Text>
                    <Box
                      className={`toggleRow ${draftSettings.rampnetworkEnabled ? "isActive" : ""}`}
                    >
                      <Checkbox
                        checked={draftSettings.rampnetworkEnabled}
                        onCheckedChange={(checked) =>
                          setDraftSettings((current) => ({
                            ...current,
                            rampnetworkEnabled: Boolean(checked),
                          }))
                        }
                      >
                        Ramp Network
                      </Checkbox>
                      <span className="toggleText">
                        {providerStatusByKey.get("rampnetwork")?.environment ?? "unknown"} · API
                        key: {overview.secrets.rampnetworkApiKey} · webhook key:{" "}
                        {overview.secrets.rampnetworkWebhookSecret}
                      </span>
                    </Box>

                    <Box className={`toggleRow ${draftSettings.moonpayEnabled ? "isActive" : ""}`}>
                      <Checkbox
                        checked={draftSettings.moonpayEnabled}
                        onCheckedChange={(checked) =>
                          setDraftSettings((current) => ({
                            ...current,
                            moonpayEnabled: Boolean(checked),
                          }))
                        }
                      >
                        MoonPay
                      </Checkbox>
                      <span className="toggleText">
                        {providerStatusByKey.get("moonpay")?.environment ?? "unknown"} · publishable
                        key: {overview.secrets.moonpayPublishableKey}
                      </span>
                    </Box>

                    <Box
                      className={`toggleRow ${draftSettings.nowpaymentsEnabled ? "isActive" : ""}`}
                    >
                      <Checkbox
                        checked={draftSettings.nowpaymentsEnabled}
                        onCheckedChange={(checked) =>
                          setDraftSettings((current) => ({
                            ...current,
                            nowpaymentsEnabled: Boolean(checked),
                          }))
                        }
                      >
                        NOWPayments
                      </Checkbox>
                      <span className="toggleText">
                        {providerStatusByKey.get("nowpayments")?.environment ?? "unknown"} · key
                        status: {overview.secrets.nowpaymentsApiKey}
                      </span>
                    </Box>
                  </Box>

                  <Box className="providerSettingsColumn">
                    <label className="fieldLabel">
                      Fallback provider
                      <select
                        className="selectInput"
                        value={draftSettings.defaultProvider}
                        onChange={(event) =>
                          setDraftSettings((current) => ({
                            ...current,
                            defaultProvider: event.target.value as
                              | "nowpayments"
                              | "moonpay"
                              | "rampnetwork",
                          }))
                        }
                      >
                        <option value="rampnetwork">Ramp Network</option>
                        <option value="moonpay">MoonPay</option>
                        <option value="nowpayments">NOWPayments</option>
                      </select>
                      <small className="mutedText">
                        Used only when `paymentGateway.data` does not include a provider choice from
                        the storefront.
                      </small>
                    </label>

                    <label className="fieldLabel">
                      Payment country rule
                      <select
                        className="selectInput"
                        value={draftSettings.countryRestrictions.mode}
                        onChange={(event) =>
                          setDraftSettings((current) => ({
                            ...current,
                            countryRestrictions: {
                              ...current.countryRestrictions,
                              mode: event.target.value as "allow_all" | "allow_list" | "block_list",
                            },
                          }))
                        }
                      >
                        <option value="allow_all">Allow all countries</option>
                        <option value="allow_list">Allow only selected countries</option>
                        <option value="block_list">Block selected countries</option>
                      </select>
                      <small className="mutedText">
                        This rule blocks payment initialization only. Checkout and cart updates stay
                        available.
                      </small>
                    </label>

                    <label className="fieldLabel">
                      Country codes
                      <input
                        type="text"
                        className="selectInput"
                        value={countryRestrictionsInput}
                        onChange={(event) => setCountryRestrictionsInput(event.target.value)}
                        placeholder="TH, SG, MY"
                        disabled={draftSettings.countryRestrictions.mode === "allow_all"}
                      />
                      <small className="mutedText">
                        Use ISO country codes (see{" "}
                        <a
                          href="https://docs.saleor.io/api-reference/miscellaneous/enums/country-code"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="docReferenceLink"
                        >
                          Saleor CountryCode enum
                        </a>
                        ) separated by commas. Default rollout is Thailand-only (`TH`).
                      </small>
                    </label>
                  </Box>
                </Box>

                <Box className="actionsRow end providerSettingsSaveRow">
                  <Button type="submit" disabled={savingSettings}>
                    {savingSettings ? "Saving…" : "Save settings"}
                  </Button>
                </Box>
              </Box>
            </Box>
          ) : null}

          {section === "transactions" ? (
            <Box className="stackLarge">
              <Box className="appCard">
                <SectionHeader
                  title="Transaction lookup"
                  description="Search by Saleor transaction ID or provider reference, then inspect current state, hosted URL, and timeline."
                />
                <Box className="searchPanel">
                  <label className="searchLabel" htmlFor="transaction-search">
                    Search by Saleor transaction ID or provider reference
                  </label>
                  <Box as="form" className="searchRow" onSubmit={handleTransactionSearch}>
                    <SearchInput
                      id="transaction-search"
                      className="searchField"
                      value={search}
                      placeholder="Search transaction or provider reference"
                      onChange={(event) => setSearch(event.target.value)}
                    />
                    <Button type="submit" className="searchButton" disabled={loading}>
                      Search
                    </Button>
                  </Box>
                </Box>
              </Box>

              <Box className="appCard">
                <SectionHeader title="Results" />
                <Box className="stackMedium">
                  <Box className="recordsToolbar">
                    <Text as="p" color="default2" className="mutedText">
                      {transactionsRangeLabel}
                    </Text>
                    {appliedTransactionSearch ? (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void handleTransactionSearchReset()}
                        disabled={loading}
                      >
                        Clear search
                      </Button>
                    ) : null}
                  </Box>
                  {loading && transactions.items.length === 0 ? (
                    <Box className="emptyState">
                      <Text as="p" className="bodyText">
                        Loading transactions...
                      </Text>
                    </Box>
                  ) : transactions.items.length === 0 ? (
                    <Box className="emptyState">
                      <Text as="p" className="bodyText">
                        {appliedTransactionSearch
                          ? "No matching transactions found."
                          : "No transactions found yet."}
                      </Text>
                    </Box>
                  ) : (
                    <Box className="dashboardTableWrapper">
                      <table className="dashboardTable">
                        <thead>
                          <tr>
                            <th scope="col">Transaction</th>
                            <th scope="col">Provider</th>
                            <th scope="col">Reference</th>
                            <th scope="col">Saleor status</th>
                            <th scope="col">Provider status</th>
                            <th scope="col">Updated</th>
                            <th scope="col">Actions</th>
                          </tr>
                        </thead>
                        {transactions.items.map((entry) => {
                          const isExpanded = expandedTransactionId === entry.session.id;
                          const providerReference = getProviderReferenceMeta(entry.session);

                          return (
                            <tbody
                              key={entry.session.id}
                              className={classNames(
                                "dashboardTableBody",
                                isExpanded && "isExpanded",
                              )}
                            >
                              <tr className="dashboardTableRow">
                                <td className="dashboardTableCell">
                                  <Box className="textStack transactionIdentityCell">
                                    <Text as="p" color="default2" className="transactionEyebrow">
                                      Saleor transaction
                                    </Text>
                                    <Text
                                      className="labelText transactionPrimaryId"
                                      title={entry.session.saleorTransactionId}
                                    >
                                      {shortenIdentifier(
                                        entry.session.saleorTransactionId,
                                        transactionIdPreviewLength,
                                      )}
                                    </Text>
                                    <Box className="transactionMetaRow">
                                      <span className="inlineMetaBadge">Session</span>
                                      <code className="inlineMetaCode" title={entry.session.id}>
                                        {shortenIdentifier(
                                          entry.session.id,
                                          sessionIdPreviewLength,
                                        )}
                                      </code>
                                    </Box>
                                  </Box>
                                </td>
                                <td className="dashboardTableCell">
                                  <Text as="p" className="bodyText">
                                    <ProviderChip provider={entry.session.provider} />
                                  </Text>
                                </td>
                                <td className="dashboardTableCell">
                                  <Box className="textStack referenceCell">
                                    <Text as="p" color="default2" className="referenceLabel">
                                      {providerReference.label}
                                    </Text>
                                    <Text
                                      as="p"
                                      className="bodyText referenceValue"
                                      title={providerReference.value}
                                    >
                                      {providerReference.value === "Not assigned yet"
                                        ? providerReference.value
                                        : shortenIdentifier(providerReference.value)}
                                    </Text>
                                    <Text
                                      as="p"
                                      color="default2"
                                      className="mutedText referenceMetaText"
                                    >
                                      {entry.session.safeErrorSummary ?? "No safe error"}
                                    </Text>
                                  </Box>
                                </td>
                                <td className="dashboardTableCell">
                                  <StatusChip>{entry.session.saleorStatus}</StatusChip>
                                </td>
                                <td className="dashboardTableCell">
                                  <StatusChip>{entry.session.providerStatus}</StatusChip>
                                </td>
                                <td className="dashboardTableCell">
                                  <Box className="textStack updatedCell">
                                    <Text as="p" className="bodyText updatedPrimaryText">
                                      {formatRelativeTime(entry.session.updatedAt)}
                                    </Text>
                                    <Text as="p" color="default2" className="mutedText">
                                      {formatDate(entry.session.updatedAt)}
                                    </Text>
                                  </Box>
                                </td>
                                <td className="dashboardTableCell dashboardTableActionsCell">
                                  <Box className="dashboardTableActions">
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      className="iconActionButton"
                                      icon={
                                        isExpanded ? (
                                          <ChervonUpIcon size="small" />
                                        ) : (
                                          <ChervonDownIcon size="small" />
                                        )
                                      }
                                      aria-expanded={isExpanded}
                                      aria-label={
                                        isExpanded
                                          ? "Hide transaction details"
                                          : "Show transaction details"
                                      }
                                      title={isExpanded ? "Hide details" : "Show details"}
                                      onClick={() =>
                                        setExpandedTransactionId((current) =>
                                          current === entry.session.id ? null : entry.session.id,
                                        )
                                      }
                                    />
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      className="iconActionButton"
                                      icon={<SyncIcon />}
                                      title={
                                        reconcilingTransactionId ===
                                        entry.session.saleorTransactionId
                                          ? "Syncing from provider"
                                          : "Fetch the latest status from the payment provider and update Saleor for this transaction."
                                      }
                                      aria-label={
                                        reconcilingTransactionId ===
                                        entry.session.saleorTransactionId
                                          ? "Syncing from provider"
                                          : "Sync from provider"
                                      }
                                      disabled={
                                        reconcilingTransactionId ===
                                        entry.session.saleorTransactionId
                                      }
                                      onClick={() =>
                                        handleReconcile(entry.session.saleorTransactionId)
                                      }
                                    />
                                    {entry.session.redirectUrl || entry.session.hostedUrl ? (
                                      <Button
                                        type="button"
                                        variant="secondary"
                                        className="iconActionButton"
                                        icon={<ExternalLinkIcon size="small" />}
                                        title="Opens the provider-hosted payment page (checkout or return URL) in a new tab."
                                        aria-label="Open payment page"
                                        onClick={() =>
                                          openExternal(
                                            entry.session.redirectUrl ??
                                              entry.session.hostedUrl ??
                                              "",
                                          )
                                        }
                                      />
                                    ) : null}
                                  </Box>
                                </td>
                              </tr>
                              {isExpanded ? (
                                <tr className="dashboardTableDetailRow">
                                  <td colSpan={7} className="dashboardTableDetailCell">
                                    <Box className="transactionCard">
                                      <dl className="definitionList compact">
                                        <div>
                                          <dt>Saleor transaction ID</dt>
                                          <dd>{entry.session.saleorTransactionId}</dd>
                                        </div>
                                        <div>
                                          <dt>Session ID</dt>
                                          <dd>{entry.session.id}</dd>
                                        </div>
                                        <div>
                                          <dt>Provider reference</dt>
                                          <dd>{providerReference.value}</dd>
                                        </div>
                                        <div>
                                          <dt>Safe error summary</dt>
                                          <dd>{entry.session.safeErrorSummary ?? "None"}</dd>
                                        </div>
                                        <div>
                                          <dt>Hosted URL</dt>
                                          <dd>
                                            {entry.session.hostedUrl ? (
                                              <a
                                                href={entry.session.hostedUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="docReferenceLink"
                                              >
                                                {entry.session.hostedUrl}
                                              </a>
                                            ) : (
                                              "Not available"
                                            )}
                                          </dd>
                                        </div>
                                        <div>
                                          <dt>Redirect URL</dt>
                                          <dd>
                                            {entry.session.redirectUrl ? (
                                              <a
                                                href={entry.session.redirectUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="docReferenceLink"
                                              >
                                                {entry.session.redirectUrl}
                                              </a>
                                            ) : (
                                              "Not available"
                                            )}
                                          </dd>
                                        </div>
                                      </dl>

                                      <Box className="timeline">
                                        {entry.timeline.map((timelineEvent) => (
                                          <Box key={timelineEvent.id} className="timelineItem">
                                            <Text as="p" className="bodyText">
                                              {timelineEvent.eventType} ·{" "}
                                              {timelineEvent.providerStatus ??
                                                timelineEvent.saleorStatus ??
                                                "n/a"}
                                            </Text>
                                            <Text as="p" color="default2" className="mutedText">
                                              {formatDate(timelineEvent.createdAt)}
                                            </Text>
                                          </Box>
                                        ))}
                                      </Box>

                                      <details className="detailsPanel">
                                        <summary>Sanitized payload summary</summary>
                                        <pre className="monoBlock">
                                          {prettyJson(entry.session.lastWebhookPayload)}
                                        </pre>
                                      </details>
                                    </Box>
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          );
                        })}
                      </table>
                    </Box>
                  )}

                  <Box className="paginationBar">
                    <Text as="p" color="default2" className="mutedText">
                      {transactionsRangeLabel}
                    </Text>
                    <Box className="paginationActions">
                      <Button
                        variant="secondary"
                        disabled={!transactions.hasPreviousPage || loading}
                        onClick={() => void handleTransactionsPageChange(transactions.page - 1)}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={!transactions.hasNextPage || loading}
                        onClick={() => void handleTransactionsPageChange(transactions.page + 1)}
                      >
                        Next
                      </Button>
                    </Box>
                  </Box>
                </Box>
              </Box>
            </Box>
          ) : null}

          {section === "diagnostics" ? (
            <Box className="stackLarge">
              {overview.warnings.length > 0 ? (
                <Box className="appCard noticeCard isWarn">
                  <SectionHeader title="Configuration warnings" />
                  <Box className="stackSmall">
                    {overview.warnings.map((warning) => (
                      <Text key={warning} as="p" className="bodyText">
                        {warning}
                      </Text>
                    ))}
                  </Box>
                </Box>
              ) : null}

              <Box className="cardGrid">
                <Box className="appCard">
                  <SectionHeader title="Runtime diagnostics" />
                  <dl className="definitionList">
                    <div>
                      <dt>Database</dt>
                      <dd>
                        {diagnostics?.database.ok
                          ? "Connected"
                          : (diagnostics?.database.error ?? "Unknown")}
                      </dd>
                    </div>
                    <div>
                      <dt>APL / auth</dt>
                      <dd>{diagnostics?.apl.configured ? "Configured" : "Missing"}</dd>
                    </div>
                    <div>
                      <dt>Saleor API</dt>
                      <dd>{diagnostics?.apl.saleorApiUrl ?? "Unknown"}</dd>
                    </div>
                    <div>
                      <dt>App ID</dt>
                      <dd>{diagnostics?.apl.appId ?? "Unknown"}</dd>
                    </div>
                  </dl>
                </Box>

                <Box className="appCard">
                  <SectionHeader title="Webhook summary" />
                  <dl className="definitionList">
                    <div>
                      <dt>Last provider webhook</dt>
                      <dd>{formatDate(diagnostics?.latestWebhook?.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>Last provider status</dt>
                      <dd>{diagnostics?.latestWebhook?.providerStatus ?? "None yet"}</dd>
                    </div>
                    <div>
                      <dt>Last safe error</dt>
                      <dd>{diagnostics?.lastSafeErrorSummary ?? "None recorded"}</dd>
                    </div>
                    <div>
                      <dt>Environment</dt>
                      <dd>{overview.connection.environment}</dd>
                    </div>
                  </dl>
                </Box>

                <Box className="appCard">
                  <SectionHeader title="Provider config audit" />
                  <Box className="stackSmall">
                    {orderedDiagnosticsProviders.map((provider) => (
                      <Box key={provider.provider} className="miniCard">
                        <Box className="providerRow">
                          <Box className="textStack">
                            <Text className="labelText">{provider.provider}</Text>
                            <Text as="p" color="default2" className="mutedText">
                              {provider.environment} · {provider.summary}
                            </Text>
                          </Box>
                          <StatusChip>
                            {provider.enabled
                              ? provider.isConfigured
                                ? "Configured"
                                : "Needs config"
                              : "Disabled"}
                          </StatusChip>
                        </Box>
                        {provider.missingFields.length > 0 ? (
                          <Text as="p" color="default2" className="mutedText">
                            Missing: {provider.missingFields.join(", ")}
                          </Text>
                        ) : null}
                      </Box>
                    ))}
                  </Box>
                </Box>
              </Box>
            </Box>
          ) : null}
        </>
      )}
    </Box>
  );
};
