import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { PaymentCountryRestrictionConfig } from "@/modules/payments/types";

export const saleorAppAuth = pgTable("saleor_app_auth", {
  saleorApiUrl: text("saleor_api_url").primaryKey(),
  token: text("token").notNull(),
  appId: text("app_id").notNull(),
  jwks: text("jwks"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const appSettings = pgTable(
  "app_settings",
  {
    saleorApiUrl: text("saleor_api_url")
      .notNull()
      .references(() => saleorAppAuth.saleorApiUrl, { onDelete: "cascade" }),
    defaultProvider: text("default_provider").notNull(),
    nowpaymentsEnabled: boolean("nowpayments_enabled").notNull().default(true),
    moonpayEnabled: boolean("moonpay_enabled").notNull().default(true),
    rampnetworkEnabled: boolean("rampnetwork_enabled").notNull().default(true),
    countryRestrictions: jsonb("country_restrictions")
      .$type<PaymentCountryRestrictionConfig>()
      .notNull()
      .default(sql`'{"version":1,"mode":"allow_list","countries":["TH"],"addressSource":"shipping_only"}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.saleorApiUrl] }),
  })
);

export const paymentSessions = pgTable(
  "payment_sessions",
  {
    id: text("id").primaryKey(),
    saleorApiUrl: text("saleor_api_url")
      .notNull()
      .references(() => saleorAppAuth.saleorApiUrl, { onDelete: "cascade" }),
    saleorTransactionId: text("saleor_transaction_id").notNull(),
    saleorTransactionToken: text("saleor_transaction_token"),
    saleorPspReference: text("saleor_psp_reference"),
    saleorMerchantReference: text("saleor_merchant_reference").notNull(),
    saleorSourceObjectType: text("saleor_source_object_type").notNull(),
    saleorSourceObjectId: text("saleor_source_object_id").notNull(),
    checkoutId: text("checkout_id"),
    orderId: text("order_id"),
    customerEmail: text("customer_email"),
    channelSlug: text("channel_slug"),
    provider: text("provider").notNull(),
    providerPaymentId: text("provider_payment_id"),
    providerInvoiceId: text("provider_invoice_id"),
    providerReferenceId: text("provider_reference_id"),
    providerStatus: text("provider_status").notNull(),
    saleorStatus: text("saleor_status").notNull(),
    amount: numeric("amount", { precision: 18, scale: 6 }).notNull(),
    currency: text("currency").notNull(),
    hostedUrl: text("hosted_url"),
    redirectUrl: text("redirect_url"),
    idempotencyKey: text("idempotency_key").notNull(),
    lastWebhookPayload: jsonb("last_webhook_payload"),
    complianceContract: jsonb("compliance_contract"),
    safeErrorSummary: text("safe_error_summary"),
    statusReason: text("status_reason"),
    finalizationState: text("finalization_state").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => ({
    transactionUnique: uniqueIndex("payment_sessions_saleor_transaction_unique").on(
      table.saleorApiUrl,
      table.saleorTransactionId
    ),
    idempotencyUnique: uniqueIndex("payment_sessions_idempotency_unique").on(
      table.saleorApiUrl,
      table.idempotencyKey
    ),
    providerReferenceIndex: index("payment_sessions_provider_reference_idx").on(
      table.provider,
      table.providerReferenceId
    ),
  })
);

export const paymentSessionEvents = pgTable(
  "payment_session_events",
  {
    id: text("id").primaryKey(),
    paymentSessionId: text("payment_session_id")
      .notNull()
      .references(() => paymentSessions.id, { onDelete: "cascade" }),
    saleorApiUrl: text("saleor_api_url").notNull(),
    source: text("source").notNull(),
    eventType: text("event_type").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    providerEventId: text("provider_event_id"),
    providerStatus: text("provider_status"),
    saleorStatus: text("saleor_status"),
    message: text("message"),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    dedupeUnique: uniqueIndex("payment_session_events_dedupe_unique").on(table.dedupeKey),
    paymentSessionIndex: index("payment_session_events_payment_session_idx").on(table.paymentSessionId),
  })
);

export const saleorAppAuthRelations = relations(saleorAppAuth, ({ many, one }) => ({
  settings: one(appSettings, {
    fields: [saleorAppAuth.saleorApiUrl],
    references: [appSettings.saleorApiUrl],
  }),
  sessions: many(paymentSessions),
}));

export const paymentSessionsRelations = relations(paymentSessions, ({ many }) => ({
  events: many(paymentSessionEvents),
}));

export const databaseReadyQuery = sql`select 1`;
