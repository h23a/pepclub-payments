# AGENTS.md

## Purpose

This repository is a private Saleor payment app for Pepclub. It started from `saleor/saleor-app-template`, but it is not a generic example app anymore.

## Architecture

- `src/pages/api/manifest.ts` and `src/pages/api/register.ts` are the canonical Saleor app entrypoints.
- `src/saleor-app.ts` wires the app SDK and APL.
- `src/pages/api/webhooks/transaction/*.ts` are the Saleor sync webhook handlers.
- `src/pages/api/webhooks/providers/*.ts` are provider callbacks.
- `src/modules/payments/*` contains payment orchestration and provider resolution.
- `src/modules/dashboard/*` contains embedded dashboard APIs and validation.
- `src/modules/db/*` contains Drizzle persistence.

## Intentional Divergences From The Template

- The app is single-tenant by default and only accepts installs from `SALEOR_API_URL`.
- The app uses a Postgres-backed APL by default because business data already depends on Postgres.
- Local development is expected to run with the database available, even when all payment providers are disabled.

## GraphQL Rules

- Do not hand-write Saleor operation strings in application code when a `.graphql` document can be used instead.
- Put Saleor GraphQL operations in `graphql/fragments`, `graphql/mutations`, `graphql/queries`, or `graphql/subscriptions`.
- After adding or changing any `.graphql` document, run `pnpm generate`.
- Treat `generated/graphql.ts` as generated code. Do not edit it manually.
- If webhook payload shapes are needed in TypeScript, derive them from generated GraphQL types instead of duplicating payload interfaces.

## Webhook Rules

- Keep webhook handlers on `SaleorSyncWebhook` or `SaleorAsyncWebhook` from the Saleor app SDK.
- Keep `bodyParser: false` on webhook routes so signature verification remains possible.
- Keep JSON-schema response typings under `generated/app-webhooks-types` in sync with the actual sync webhooks implemented by the app.

## Environment Rules

- `.env.example` must stay bootable for local development without real provider credentials.
- Provider-specific secrets are only required when the corresponding provider is enabled.
- Avoid adding new required environment variables unless the app cannot safely operate without them.

## Generated Artifacts

- Commit `generated/**` changes when source GraphQL documents or webhook schemas change.
- If `pnpm generate` produces a diff, either commit the regenerated output or fix the source drift before finishing.

## Verification Expectations

- Run `pnpm generate` after GraphQL or webhook schema changes.
- Run `pnpm lint`, `pnpm check-types`, `pnpm test:run`, and `pnpm build` before considering a substantial change complete.
- Prefer small, source-driven fixes over editing generated files directly.
