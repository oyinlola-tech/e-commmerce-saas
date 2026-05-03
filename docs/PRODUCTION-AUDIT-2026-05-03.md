# Aisle Commerce Production Audit

Audit date: May 3, 2026

This audit reflects the repository state after the production-hardening work in this branch, including:

- `485642e` `fix: make event delivery durable with redis fallback`
- `579267b` `fix: harden payment webhooks and reconciliation`
- `0550fe9` `feat: queue notification emails with retries`
- `390db33` `feat: enforce plan limits across stores and products`
- `94ae976` `feat: add checkout shipping and tax totals`
- `f4408c0` `security: encrypt compliance records at rest`
- `a947768` `security: require explicit production admin bootstrap credentials`
- `6cd3ffb` `feat: enforce marketing plan capabilities`
- `ccc2c4b` `feat: add guided store launch onboarding`
- `da21b9e` `feat: add verified product reviews and moderation`

## Flow Validation

### Store owner flow

- `PASS WITH GAPS`: signup -> login -> subscription trial/activation -> store creation -> product upload -> payment configuration -> first sale path exists across `user-service`, `billing-service`, `store-service`, `product-service`, `order-service`, `payment-service`, gateway, and SSR web routes.
- `Validated`: owner auth, trial checkout, store creation, plan enforcement for stores/products/marketing, launch-guide persistence, owner-scoped admin product CRUD, order list/detail, refund initiation, payment provider configuration.
- `Remaining gaps`: no automated browser coverage for the first-sale path, no owner-facing cross-store operational overview for failed async work, and subscription billing remains provider-skewed toward Paystack.

### Customer flow

- `PASS WITH GAPS`: browse -> product -> cart -> checkout -> payment -> order confirmation exists across storefront SSR, cart, order, payment, and notification services.
- `Validated`: customer registration/login, cart mutations, coupon preview, checkout quoting with shipping and tax, hosted payment initiation, payment callback verification, order confirmation, transactional email delivery, approved review rendering, and verified-purchase review submission.
- `Remaining gaps`: no guest checkout, no saved-payment or resume-checkout UX, no shipping ETA estimation, and limited post-purchase retention beyond receipts, reviews, and confirmation pages.

### Admin flow

- `PARTIAL`: store-level admin operations are real, but platform-wide support and incident operations remain intentionally incomplete.
- `Validated`: platform owner login, billing plan management, compliance review, store management, launch tracking, product-review moderation, and refund initiation.
- `Blocked/incomplete`: support queue, incident management, live chat, and the related services remain placeholders or preview surfaces.

## What Was Fixed In This Pass

- Event delivery no longer disappears when RabbitMQ is unavailable. The shared bus now uses RabbitMQ retry/DLQ semantics with a Redis-backed durable fallback instead of a no-op publisher.
- Payment intake is now idempotent and recoverable. Webhooks are persisted with retry state, due payments are reconciled in the background, and pending orders can be re-verified instead of waiting forever on callbacks.
- Email delivery is now a durable async queue backed by `outbound_emails`, with retry, stale-lock recovery, and dead-letter visibility.
- Billing is now a real source of truth for plan limits. Store creation/activation, product management, and marketing coupon workflows enforce subscription entitlements instead of trusting the UI.
- Checkout totals now include shipping and tax calculations sourced from store configuration and applied before payment intent creation.
- Compliance records now support encrypted-at-rest fields for sensitive KYC, KYB, and document payloads.
- Production startup now rejects placeholder platform-admin bootstrap credentials instead of silently creating a weak default admin.
- Store owners now have a guided launch workflow backed by persisted onboarding state in `store-service` instead of a dashboard-only checklist.
- Product trust is now materially stronger. Verified reviews are gated by paid or fulfilled orders, routed through moderation, aggregated back into product ratings, and visible in both storefront and store-admin workflows.

## Remaining Gaps

### CRITICAL

- `Platform operations`: `support-service` and `chat-service` are still placeholder packages while the product surface already exposes platform-operations preview routes. For a multi-tenant SaaS, this leaves incident response, merchant support, and internal escalation incomplete.
  File areas: `apps/services/support-service/README.md`, `apps/services/chat-service/README.md`, `apps/web/views/platform/control-placeholder.ejs`

- `Compliance integrations`: compliance is still a manual capture-and-review workflow. There is no external KYC/KYB verification provider, sanctions screening, document OCR, or adverse-media check.
  File areas: `apps/services/compliance-service/src/routes.js`

- `Billing provider parity`: storefront checkout supports Paystack and Flutterwave, but subscription trial activation and recurring billing remain Paystack-first. That means billing-service is not yet provider-neutral for SaaS plan activation.
  File areas: `apps/services/billing-service/src/routes.js`, `apps/services/billing-service/src/consumers.js`

### HIGH

- `Testing / release safety`: there is still no meaningful automated integration or browser test suite covering the owner first-sale path or the customer checkout/payment confirmation path.
  File areas: `tests/`, repo-wide

- `Storage / deployment`: store assets still rely on local-disk uploads. That breaks horizontal scaling and failover for production deployments.
  File areas: `apps/services/store-service/src/routes.js`, `docs/KNOWN-GAPS.md`

- `Billing / entitlements`: stores, products, and marketing are now enforced, but storage quotas, API quotas, analytics access, and over-limit downgrade handling for historical data remain incomplete.
  File areas: `apps/services/billing-service/src/plans.js`, `apps/services/billing-service/src/routes.js`

- `Supportability`: event and email dead-letter handling now exists, but there is still no operator-facing admin tooling to inspect, replay, or clear dead-lettered work safely.
  File areas: `packages/shared/src/events.js`, `apps/services/notification-service/src/outbound-email.js`

### MEDIUM

- `Customer conversion`: no guest checkout, no saved payment methods, no shipping ETA estimation, and no payment-retry resume experience beyond redirect callbacks.
  File areas: `apps/web/src/routes/storefront.js`, `apps/web/views/storefront/checkout.ejs`

- `Analytics`: plans reference analytics capability, but there is no analytics service or owner-facing reporting workflow that actually consumes that entitlement.
  File areas: `apps/services/billing-service/src/plans.js`, `apps/web/src/lib/renderers.js`

- `Lifecycle marketing`: the notification service has a broad template catalog, but several lifecycle and retention workflows are still template-ready rather than fully wired.
  File areas: `apps/services/notification-service/src/template-catalog.js`, `docs/EMAIL-TEMPLATES.md`

- `Owner workspace`: launch guidance now exists inside store admin, but the owner dashboard still does not aggregate per-store onboarding or async-failure health into one cross-store control surface.
  File areas: `apps/web/views/platform/dashboard.ejs`, `apps/web/src/lib/renderers.js`

## Recommended Next Production Sequence

1. Replace placeholder support/chat packages with real services or remove those routes and surfaces from the product promise.
2. Add a real KYC/KYB provider and sanctions-screening workflow behind the compliance service.
3. Finish provider-neutral subscription billing so Flutterwave can activate and renew plans with the same guarantees as Paystack.
4. Add end-to-end browser coverage for the owner first-sale path and the customer checkout/payment confirmation path.
5. Finish plan enforcement for remaining quotable resources such as analytics, storage, and API usage.
