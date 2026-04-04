import { actions, useAppBridge } from "@saleor/app-sdk/app-bridge";
import { Box, Button, Checkbox, Chip, SearchInput, Text } from "@saleor/macaw-ui";
import { FormEvent, useEffect, useMemo, useState } from "react";

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

type TransactionLookupResponse = Array<{
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
}>;

const formatDate = (value?: string | null) => {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

const prettyJson = (value: unknown) => JSON.stringify(value ?? {}, null, 2);

const providerOrder = ["rampnetwork", "moonpay", "nowpayments"] as const;

const sections = [
  { id: "overview", label: "Overview" },
  { id: "providers", label: "Providers" },
  { id: "transactions", label: "Transactions" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "help", label: "Help" },
] as const;

const classNames = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

const getChipTone = (value: string) => {
  const normalized = value.toLowerCase();

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
    (left, right) => providerOrder.indexOf(left.provider) - providerOrder.indexOf(right.provider)
  );

export const DashboardPage = () => {
  const { appBridge, appBridgeState } = useAppBridge();
  const [section, setSection] = useState<(typeof sections)[number]["id"]>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResponse | null>(null);
  const [transactions, setTransactions] = useState<TransactionLookupResponse>([]);
  const [search, setSearch] = useState("");
  const [draftSettings, setDraftSettings] = useState({
    defaultProvider: "nowpayments" as "nowpayments" | "moonpay" | "rampnetwork",
    nowpaymentsEnabled: true,
    moonpayEnabled: true,
    rampnetworkEnabled: true,
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [reconcilingTransactionId, setReconcilingTransactionId] = useState<string | null>(null);

  const isEmbedded = Boolean(
    appBridgeState?.ready && appBridgeState.saleorApiUrl && appBridgeState.token
  );

  const fetchAppApi = async <T,>(
    path: string,
    init?: {
      method?: "GET" | "POST";
      body?: Record<string, unknown>;
    }
  ) => {
    if (!appBridgeState?.saleorApiUrl || !appBridgeState.token) {
      throw new Error("Saleor app bridge is not ready.");
    }

    const response = await fetch(path, {
      method: init?.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "authorization-bearer": appBridgeState.token,
        "saleor-api-url": appBridgeState.saleorApiUrl,
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload?.message ?? "Request failed");
    }

    return payload as T;
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
        })
      );
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  };

  const loadDashboard = async (transactionSearch?: string) => {
    if (!isEmbedded) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [overviewResponse, diagnosticsResponse, transactionsResponse] = await Promise.all([
        fetchAppApi<OverviewResponse>("/api/dashboard/overview"),
        fetchAppApi<DiagnosticsResponse>("/api/dashboard/diagnostics"),
        fetchAppApi<TransactionLookupResponse>(
          `/api/dashboard/transactions${
            transactionSearch ? `?search=${encodeURIComponent(transactionSearch)}` : ""
          }`
        ),
      ]);

      setOverview(overviewResponse);
      setDiagnostics(diagnosticsResponse);
      setTransactions(transactionsResponse);
      setDraftSettings({
        defaultProvider: overviewResponse.settings.defaultProvider,
        nowpaymentsEnabled: overviewResponse.settings.nowpaymentsEnabled,
        moonpayEnabled: overviewResponse.settings.moonpayEnabled,
        rampnetworkEnabled: overviewResponse.settings.rampnetworkEnabled,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load app data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEmbedded, appBridgeState?.saleorApiUrl, appBridgeState?.token]);

  const providerStatusByKey = useMemo(
    () => new Map(overview?.providers.map((provider) => [provider.provider, provider]) ?? []),
    [overview?.providers]
  );

  const orderedProviders = useMemo(
    () => sortProviders(overview?.providers ?? []),
    [overview?.providers]
  );

  const orderedDiagnosticsProviders = useMemo(
    () =>
      sortProviders(
        (diagnostics?.providerConfig ?? []).filter(
          (
            provider
          ): provider is DiagnosticsResponse["providerConfig"][number] & {
            provider: (typeof providerOrder)[number];
          } => providerOrder.includes(provider.provider as (typeof providerOrder)[number])
        )
      ),
    [diagnostics?.providerConfig]
  );

  const enabledProviders = useMemo(
    () =>
      orderedProviders
        .filter((provider) => provider.enabled)
        .map((provider) => provider.provider)
        .join(", ") || "None",
    [orderedProviders]
  );

  const summaryCards = useMemo(
    () => [
      {
        label: "Default provider",
        value: overview?.settings.defaultProvider ?? "Unknown",
      },
      {
        label: "Recent transactions",
        value: String(overview?.stats.recentTransactionCount ?? 0),
      },
      {
        label: "Provider webhooks",
        value: String(overview?.stats.recentWebhookCount ?? 0),
      },
      {
        label: "Latest provider event",
        value: formatDate(overview?.stats.latestWebhook?.createdAt),
        compact: true,
      },
    ],
    [overview]
  );

  const handleSettingsSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSavingSettings(true);
    setNotice(null);
    setError(null);

    try {
      await fetchAppApi("/api/dashboard/settings", {
        method: "POST",
        body: draftSettings,
      });
      setNotice("Settings saved.");
      await loadDashboard(search);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save settings.");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTransactionSearch = async (event: FormEvent) => {
    event.preventDefault();
    await loadDashboard(search);
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
      setNotice(`Reconciled ${saleorTransactionId}.`);
      await loadDashboard(search);
    } catch (reconcileError) {
      setError(
        reconcileError instanceof Error ? reconcileError.message : "Reconcile request failed."
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
          <StatusChip>{diagnostics?.database.ok ? "DB ready" : "DB issue"}</StatusChip>
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
                    <Text size={8} as="h2" className="headingText">
                      Hosted provider control plane for Pepclub checkout flows
                    </Text>
                    <Text as="p" color="default2" className="mutedText">
                      Keep provider routing, transaction reconciliation, and installation health
                      visible in a compact admin view.
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

                <Box className="summaryGrid">
                  {summaryCards.map((item) => (
                    <Box key={item.label} className="summaryCard">
                      <Text as="p" color="default2" className="mutedText">
                        {item.label}
                      </Text>
                      <Text
                        size={item.compact ? 5 : 8}
                        className={item.compact ? "summaryValueSmall" : "summaryValue"}
                      >
                        {item.value}
                      </Text>
                    </Box>
                  ))}
                </Box>
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
                      <dt>Compliance mode</dt>
                      <dd>
                        {overview.secrets.complianceSharedSecret === "configured"
                          ? "Signed compliance API"
                          : "Metadata validation"}
                      </dd>
                    </div>
                    <div>
                      <dt>MoonPay key</dt>
                      <dd>{overview.secrets.moonpayPublishableKey}</dd>
                    </div>
                    <div>
                      <dt>NOWPayments key</dt>
                      <dd>{overview.secrets.nowpaymentsApiKey}</dd>
                    </div>
                  </dl>
                </Box>

                <Box className="appCard">
                  <SectionHeader title="Recent activity" />
                  <dl className="definitionList">
                    <div>
                      <dt>Recent transactions</dt>
                      <dd>{overview.stats.recentTransactionCount}</dd>
                    </div>
                    <div>
                      <dt>Recent provider webhooks</dt>
                      <dd>{overview.stats.recentWebhookCount}</dd>
                    </div>
                    <div>
                      <dt>Latest provider event</dt>
                      <dd>{formatDate(overview.stats.latestWebhook?.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>Latest provider status</dt>
                      <dd>{overview.stats.latestWebhook?.providerStatus ?? "None yet"}</dd>
                    </div>
                  </dl>
                </Box>
              </Box>
            </Box>
          ) : null}

          {section === "providers" ? (
            <Box className="stackLarge">
              <Box className="cardGrid splitGrid">
                <Box as="form" className="appCard formCard" onSubmit={handleSettingsSubmit}>
                  <SectionHeader
                    title="Provider settings"
                    description="Runtime toggles are stored per Saleor installation. Secrets stay env-backed and are never shown after save."
                  />

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
                      {providerStatusByKey.get("rampnetwork")?.environment ?? "unknown"} · API key:{" "}
                      {overview.secrets.rampnetworkApiKey} · webhook key:{" "}
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

                  <Box className="fieldGrid">
                    <Box className="miniCard">
                      <Text className="labelText">MoonPay defaults</Text>
                      <Text as="p" color="default2" className="mutedText">
                        Base and quote currency come from env-backed operational defaults.
                      </Text>
                    </Box>
                    <Box className="miniCard">
                      <Text className="labelText">Ramp defaults</Text>
                      <Text as="p" color="default2" className="mutedText">
                        Asset, fiat currency/value, and fallback wallet address come from env-backed
                        defaults.
                      </Text>
                    </Box>
                    <Box className="miniCard">
                      <Text className="labelText">Compliance integration</Text>
                      <Text as="p" color="default2" className="mutedText">
                        {overview.secrets.complianceSharedSecret === "configured"
                          ? "Signed compliance API is configured."
                          : "Metadata validation mode is ready."}
                      </Text>
                    </Box>
                  </Box>

                  <Box className="actionsRow end">
                    <Button type="submit" disabled={savingSettings}>
                      {savingSettings ? "Saving…" : "Save settings"}
                    </Button>
                  </Box>
                </Box>

                <Box className="appCard">
                  <SectionHeader
                    title="Provider readiness"
                    description="Keep enablement, environment, and config completeness grouped in one panel."
                  />
                  <Box className="listStack">
                    {orderedProviders.map((provider) => (
                      <Box key={provider.provider} className="listRow">
                        <Box className="textStack">
                          <Text className="labelText">{provider.provider}</Text>
                          <Text as="p" color="default2" className="mutedText">
                            {provider.environment} · {provider.summary}
                          </Text>
                          {provider.missingFields.length > 0 ? (
                            <Text as="p" color="default2" className="mutedText">
                              Missing: {provider.missingFields.join(", ")}
                            </Text>
                          ) : null}
                        </Box>
                        <Box className="listActions">
                          <StatusChip>
                            {provider.enabled
                              ? provider.isConfigured
                                ? "Ready"
                                : "Needs config"
                              : "Disabled"}
                          </StatusChip>
                        </Box>
                      </Box>
                    ))}
                  </Box>
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
                    <Button type="submit" className="searchButton">
                      Search
                    </Button>
                  </Box>
                </Box>
              </Box>

              <Box className="appCard">
                <SectionHeader title="Results" />
                <Box className="stackMedium">
                  {transactions.length === 0 ? (
                    <Box className="emptyState">
                      <Text as="p" className="bodyText">
                        {search ? "No matching transactions found." : "No transactions found yet."}
                      </Text>
                    </Box>
                  ) : (
                    transactions.map((entry) => (
                      <Box key={entry.session.id} className="transactionCard">
                        <Box className="transactionHeader">
                          <Box className="textStack">
                            <Text className="labelText">{entry.session.saleorTransactionId}</Text>
                            <Text as="p" color="default2" className="mutedText">
                              {entry.session.provider} · {entry.session.providerStatus} ·{" "}
                              {formatDate(entry.session.updatedAt)}
                            </Text>
                          </Box>
                          <Box className="statusRow">
                            <StatusChip>{entry.session.saleorStatus}</StatusChip>
                            <Button
                              variant="secondary"
                              disabled={
                                reconcilingTransactionId === entry.session.saleorTransactionId
                              }
                              onClick={() => handleReconcile(entry.session.saleorTransactionId)}
                            >
                              {reconcilingTransactionId === entry.session.saleorTransactionId
                                ? "Reconciling…"
                                : "Manual reconcile"}
                            </Button>
                            {(entry.session.redirectUrl || entry.session.hostedUrl) && (
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  openExternal(
                                    entry.session.redirectUrl ?? entry.session.hostedUrl ?? ""
                                  )
                                }
                              >
                                Open hosted flow
                              </Button>
                            )}
                          </Box>
                        </Box>

                        <dl className="definitionList compact">
                          <div>
                            <dt>Provider reference</dt>
                            <dd>
                              {entry.session.providerReferenceId ??
                                entry.session.providerPaymentId ??
                                entry.session.providerInvoiceId ??
                                "Not assigned yet"}
                            </dd>
                          </div>
                          <div>
                            <dt>Safe error summary</dt>
                            <dd>{entry.session.safeErrorSummary ?? "None"}</dd>
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
                    ))
                  )}
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
                          : diagnostics?.database.error ?? "Unknown"}
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

          {section === "help" ? (
            <Box className="appCard">
              <SectionHeader
                title="Help"
                description="Reference payloads and routing expectations for the companion payments + compliance setup."
              />
              <Box className="helpGrid">
                <Box className="helpItem helpCard">
                  <Box className="helpIntro">
                    <Text className="labelText">Expected compliance contract</Text>
                    <Text as="p" color="default2" className="mutedText">
                      Reference payload for compliance metadata and signed API mode.
                    </Text>
                  </Box>
                  <pre className="monoBlock">
                    {prettyJson({
                      waiverAccepted: true,
                      waiverAcceptedAt: "2026-04-02T13:00:00.000Z",
                      waiverTextVersion: "pepclub-waiver-v1",
                      complianceRecordId: "cmp_123",
                      signatureMode: "CLICKWRAP",
                      signatureCompleted: true,
                    })}
                  </pre>
                  <Text as="p" color="default2" className="mutedText">
                    Metadata mode also accepts the scalar `pepclubCompliance*` keys written by the
                    companion compliance app. API mode additionally honors `isPaymentAllowed`,
                    `reason`, and `nextAction`.
                  </Text>
                </Box>
                <Box className="helpItem helpCard">
                  <Box className="helpIntro">
                    <Text className="labelText">Expected paymentGateway.data</Text>
                    <Text as="p" color="default2" className="mutedText">
                      Base request shape for provider selection, buyer details, and compliance data.
                    </Text>
                  </Box>
                  <pre className="monoBlock">
                    {prettyJson({
                      provider: "rampnetwork",
                      walletAddress: "0x1234...abcd",
                      email: "guest@example.com",
                      asset: "ETH",
                      fiatCurrency: "USD",
                      fiatValue: "100",
                      compliance: {
                        waiverAccepted: true,
                        waiverAcceptedAt: "2026-04-02T13:00:00.000Z",
                        waiverTextVersion: "pepclub-waiver-v1",
                        complianceRecordId: "cmp_123",
                        signatureMode: "CLICKWRAP",
                      },
                    })}
                  </pre>
                </Box>
                <Box className="helpItem helpCard">
                  <Box className="helpIntro">
                    <Text className="labelText">MoonPay payload</Text>
                    <Text as="p" color="default2" className="mutedText">
                      Example request when the checkout explicitly targets MoonPay.
                    </Text>
                  </Box>
                  <pre className="monoBlock">
                    {prettyJson({
                      provider: "moonpay",
                      baseCurrency: "usd",
                      quoteCurrency: "btc",
                      walletAddress: "bc1qexample",
                      compliance: {
                        waiverAccepted: true,
                        waiverAcceptedAt: "2026-04-02T13:00:00.000Z",
                        waiverTextVersion: "pepclub-waiver-v1",
                        complianceRecordId: "cmp_123",
                        signatureMode: "CLICKWRAP",
                      },
                    })}
                  </pre>
                </Box>
                <Box className="helpItem helpCard">
                  <Box className="helpIntro">
                    <Text className="labelText">Provider selection rules</Text>
                    <Text as="p" color="default2" className="mutedText">
                      Operational rules that decide provider routing and compliance validation.
                    </Text>
                  </Box>
                  <Box className="helpPoints">
                    <Text as="p" color="default2" className="mutedText">
                      Explicit provider in `paymentGateway.data` wins. Otherwise the app uses the
                      installation fallback provider from settings.
                    </Text>
                    <Text as="p" color="default2" className="mutedText">
                      When compliance API mode is enabled, this app calls
                      `/api/internal/compliance/status` on the compliance service using
                      `x-pepclub-shared-secret`.
                    </Text>
                  </Box>
                </Box>
                <Box className="helpItem helpCard">
                  <Box className="helpIntro">
                    <Text className="labelText">Hosted flow response</Text>
                    <Text as="p" color="default2" className="mutedText">
                      Typical action-required response returned back to Saleor checkout.
                    </Text>
                  </Box>
                  <pre className="monoBlock">
                    {prettyJson({
                      result: "CHARGE_ACTION_REQUIRED",
                      data: {
                        provider: "rampnetwork",
                        redirectUrl: "https://app.demo.rampnetwork.com/?...",
                        providerStatus: "INITIALIZED",
                      },
                    })}
                  </pre>
                </Box>
              </Box>
            </Box>
          ) : null}
        </>
      )}
    </Box>
  );
};
