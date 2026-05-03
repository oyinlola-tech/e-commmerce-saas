# Aisle Commerce Production Audit

Audit date: May 3, 2026

This audit reflects the repository state after the production-hardening commits made in this pass:

- `485642e` `fix: make event delivery durable with redis fallback`
- `579267b` `fix: harden payment webhooks and reconciliation`
- `0550fe9` `feat: queue notification emails with retries`
- `390db33` `feat: enforce plan limits across stores and products`

## Flow Validation

### Store owner flow

- `PASS WITH GAPS`: signup -> login -> subscription checkout/trial -> store creation -> product creation -> payment configuration -> first sale path exists across `user-service`, `billing-service`, `store-service`, `product-service`, `order-service`, `payment-service`, gateway, and SSR web routes.
- `Validated`: owner auth, billing checkout, store creation, owner-scoped admin product CRUD, order list/detail, payment provider configuration.
- `Remaining gaps`: no platform-wide support/chat operations, no browser automation coverage, no shipping/tax setup, no true launch checklist completion tracking in the admin UI even though onboarding tables exist.

### Customer flow

- `PASS WITH GAPS`: browse -> product -> cart -> checkout -> payment -> order confirmation exists across storefront SSR, cart, order, and payment services.
- `Validated`: customer registration/login, cart mutations, coupon preview, hosted payment checkout, payment callback verification, order confirmation and receipts.
- `Remaining gaps`: no shipping-rate calculation, no tax engine, no guest checkout, no review submission flow, no post-purchase trust workflow beyond templates and read-only rating fields.

### Admin flow

- `PARTIAL`: store-level admin operations exist, but platform operations remain intentionally incomplete.
- `Validated`: platform owner login, billing plan management, store compliance review, owner store management, refund initiation.
- `Blocked/incomplete`: platform store directory, support queue, incident management, live chat, and support service integrations are still placeholders or reserved routes.

## What Was Fixed In This Pass

- Event delivery no longer silently disappears when RabbitMQ is unavailable. The shared bus now uses RabbitMQ retry/DLQ semantics and a Redis-backed durable fallback instead of a no-op publisher.
- Payment intake is now idempotent and recoverable. Webhooks are persisted with retry state, due payments are reconciled in the background, and pending orders re-verify payment state instead of waiting forever on callbacks.
- Email delivery is now a durable async queue backed by `outbound_emails`, with retry, stale-lock recovery, and dead-letter visibility.
- Billing is now a real source of truth for plan limits. Store creation/activation and product creation enforce subscription entitlements instead of trusting the UI.

## Remaining Gaps

### CRITICAL

- `Backend / Revenue`: checkout totals still exclude shipping and tax. `order-service` computes `subtotal - coupon` only, which is not production-safe for real commerce billing or compliance.
  File areas: `apps/services/order-service/src/routes.js`

- `Security / Compliance`: KYC and KYB identity data is stored directly in service tables without field-level encryption, tokenization, or vault-backed isolation.
  File areas: `apps/services/compliance-service/src/routes.js`, `apps/services/compliance-service/src/schema.js`

- `Integrations / Compliance`: compliance is a manual data-capture workflow only. There is no external KYC/KYB verification provider, sanctions screening, document OCR, or adverse-media check.
  File areas: `apps/services/compliance-service/src/routes.js`

- `Operational UX`: platform support and live chat are still non-runnable placeholder packages while gateway routes and socket hooks already exist. That leaves dead product surface in a multi-tenant SaaS control plane.
  File areas: `apps/services/support-service/README.md`, `apps/services/chat-service/README.md`, `apps/gateway/server.js`

### HIGH

- `Frontend / Admin UX`: platform admin store directory, support console, and incident workspace are honest placeholders rather than live workflows. Good for transparency, but the admin flow is incomplete for real operations.
  File areas: `apps/web/src/routes/platform.js`, `apps/web/views/platform/control-placeholder.ejs`

- `Backend / Trust`: product reviews have schema support and storefront display hooks, but there is no review submission, moderation, or verified-purchase publishing API.
  File areas: `database/migrations.js`, `apps/web/views/storefront/product.ejs`, `apps/services/product-service/src/routes.js`

- `Storage / Multi-instance`: store assets still rely on local disk uploads. That breaks horizontal scaling and failover for production deployments.
  File areas: `apps/services/store-service/src/routes.js`, `docs/KNOWN-GAPS.md`

- `Billing / Entitlements`: plan enforcement is now active for stores and products, but storage quotas, API quotas, team-seat controls, analytics access, and downgrade workflows for over-limit historical data are still incomplete.
  File areas: `apps/services/billing-service/src/plans.js`, `apps/services/billing-service/src/routes.js`

- `Testing / Release safety`: there is no meaningful automated integration or browser test suite covering the core owner/customer payment flows.
  File areas: `tests/`, repo-wide

- `Payments / Provider breadth`: Paystack and Flutterwave storefront checkout exist, but subscription recurring charging is still Paystack-only and depends on reusable authorization instead of a full provider-neutral billing abstraction.
  File areas: `apps/services/billing-service/src/routes.js`, `apps/services/billing-service/src/consumers.js`, `apps/services/payment-service/src/routes.js`

### MEDIUM

- `Customer UX`: no guest checkout, no shipping ETA estimation, no saved payment method UX, no retry-resume experience beyond redirect callbacks.
  File areas: `apps/web/src/routes/storefront.js`, `apps/web/views/storefront/checkout.ejs`

- `Marketing / Retention`: email templates exist for invoices, review requests, wishlist inventory alerts, and several lifecycle moments, but the actual workflows are not wired.
  File areas: `apps/services/notification-service/src/template-catalog.js`, `docs/EMAIL-TEMPLATES.md`

- `Onboarding UX`: onboarding tables exist in `store-service`, but there is no full guided "launch in under five minutes" workflow surfaced end-to-end in the owner UI.
  File areas: `database/migrations.js`, `apps/web/src/routes/platform.js`, `apps/web/views/platform/dashboard.ejs`

- `Analytics`: plans reference analytics capability, but there is no analytics service or owner reporting workflow that actually consumes that entitlement.
  File areas: `apps/services/billing-service/src/plans.js`, `apps/web/src/lib/renderers.js`

- `Supportability`: DLQ and retry state now exist for events and emails, but there is still no operator-facing admin tooling to inspect or replay dead-lettered work.
  File areas: `packages/shared/src/events.js`, `apps/services/notification-service/src/outbound-email.js`

## Recommended Next Production Sequence

1. Add shipping, tax, and fulfillment-rate calculation before any public launch.
2. Replace placeholder support/chat packages with real services or remove those routes and admin surfaces from the product promise.
3. Encrypt or externalize compliance PII, then integrate a real KYC/KYB provider.
4. Add end-to-end browser coverage for the owner first-sale path and the customer checkout/payment confirmation path.
5. Finish plan enforcement for remaining quotable resources such as analytics, storage, and API usage.
