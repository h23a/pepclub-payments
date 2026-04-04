CREATE TABLE "app_settings" (
	"saleor_api_url" text NOT NULL,
	"default_provider" text NOT NULL,
	"nowpayments_enabled" boolean DEFAULT true NOT NULL,
	"moonpay_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_saleor_api_url_pk" PRIMARY KEY("saleor_api_url")
);
--> statement-breakpoint
CREATE TABLE "payment_session_events" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_session_id" text NOT NULL,
	"saleor_api_url" text NOT NULL,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"provider_event_id" text,
	"provider_status" text,
	"saleor_status" text,
	"message" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"saleor_api_url" text NOT NULL,
	"saleor_transaction_id" text NOT NULL,
	"saleor_transaction_token" text,
	"saleor_psp_reference" text,
	"saleor_merchant_reference" text NOT NULL,
	"saleor_source_object_type" text NOT NULL,
	"saleor_source_object_id" text NOT NULL,
	"checkout_id" text,
	"order_id" text,
	"customer_email" text,
	"channel_slug" text,
	"provider" text NOT NULL,
	"provider_payment_id" text,
	"provider_invoice_id" text,
	"provider_reference_id" text,
	"provider_status" text NOT NULL,
	"saleor_status" text NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"currency" text NOT NULL,
	"hosted_url" text,
	"redirect_url" text,
	"idempotency_key" text NOT NULL,
	"last_webhook_payload" jsonb,
	"compliance_contract" jsonb,
	"safe_error_summary" text,
	"status_reason" text,
	"finalization_state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "saleor_app_auth" (
	"saleor_api_url" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"app_id" text NOT NULL,
	"jwks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_saleor_api_url_saleor_app_auth_saleor_api_url_fk" FOREIGN KEY ("saleor_api_url") REFERENCES "public"."saleor_app_auth"("saleor_api_url") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_session_events" ADD CONSTRAINT "payment_session_events_payment_session_id_payment_sessions_id_fk" FOREIGN KEY ("payment_session_id") REFERENCES "public"."payment_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sessions" ADD CONSTRAINT "payment_sessions_saleor_api_url_saleor_app_auth_saleor_api_url_fk" FOREIGN KEY ("saleor_api_url") REFERENCES "public"."saleor_app_auth"("saleor_api_url") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_session_events_dedupe_unique" ON "payment_session_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "payment_session_events_payment_session_idx" ON "payment_session_events" USING btree ("payment_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_sessions_saleor_transaction_unique" ON "payment_sessions" USING btree ("saleor_api_url","saleor_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_sessions_idempotency_unique" ON "payment_sessions" USING btree ("saleor_api_url","idempotency_key");--> statement-breakpoint
CREATE INDEX "payment_sessions_provider_reference_idx" ON "payment_sessions" USING btree ("provider","provider_reference_id");