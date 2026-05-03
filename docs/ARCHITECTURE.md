# Architecture

Proprietary software by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This system is not free to use.

## High-Level Shape

Aisle Commerce SaaS is organized as a monorepo with an SSR web experience, an HTTP gateway, and domain services. The gateway is the trust boundary for most browser-driven traffic, while the shared package provides common infrastructure for services.

## Runtime Topology

| Layer | Main files | Responsibility |
| --- | --- | --- |
| Web | `apps/web/app.js` | Renders storefront, owner, and platform admin pages |
| Gateway | `apps/gateway/server.js` | Resolves store hostnames, reads tokens, signs internal headers, and proxies traffic |
| Domain services | `apps/services/*` | Own data and business logic for each bounded context |
| Shared runtime | `packages/shared/src/*` | Env loading, database bootstrap, event bus, JWT, internal auth, logging |

## Request Flow

1. A browser request reaches the gateway on port `4000`.
2. The gateway determines whether the request is platform-hosted or storefront-hosted.
3. If store context is required, the gateway calls `store-service /resolve`.
4. The gateway extracts a platform or customer token, verifies it, and builds signed internal headers.
5. The request is proxied to the target service with identity and store metadata in headers.
6. The service verifies the internal signature before trusting the request context.

## Authentication Model

- Platform users receive JWTs from `user-service`.
- Storefront customers receive JWTs from `customer-service`.
- Internal service-to-service trust is enforced through HMAC-signed headers from `packages/shared/src/internal-auth.js`.
- Store ownership checks are delegated to `store-service`.

## Event-Driven Behavior

- `billing-service` subscribes to `USER_REGISTERED` to provision trial subscriptions for store owners.
- `order-service` subscribes to `PAYMENT_SUCCEEDED` and `PAYMENT_FAILED` to confirm or fail orders and to commit or release inventory reservations.
- Published event names are centralized in `packages/shared/src/constants.js`.
- RabbitMQ is optional at runtime. If unavailable, the shared event bus falls back to a Redis-backed durable queue with retry and dead-letter handling.

## Data Ownership

- `user-service` owns platform staff and owner identities.
- `store-service` owns tenant records, store presentation settings, and persisted launch/onboarding state.
- `compliance-service` owns KYC, KYB, uploaded documents, and reviews.
- `customer-service` owns storefront customer identities and profile data.
- `product-service` owns product records and inventory reservations.
- `cart-service` owns carts and item snapshots.
- `order-service` owns orders and order items.
- `payment-service` owns payment attempts, provider config, and webhook logs.
- `billing-service` owns subscriptions and invoices.

## Default Ports

| Component | Port |
| --- | --- |
| Web | `3000` |
| Gateway | `4000` |
| User service | `4101` |
| Store service | `4102` |
| Compliance service | `4103` |
| Customer service | `4104` |
| Product service | `4105` |
| Cart service | `4106` |
| Order service | `4107` |
| Payment service | `4108` |
| Billing service | `4109` |
| Support service | `4110` |
| Chat service | `4111` |
| Notification service | `4112` |

## Current State

The repository contains the core commerce flows, durable event/email infrastructure, shipping/tax-aware checkout, plan enforcement, and guided store-launch onboarding. Platform support/chat operations, deeper compliance integrations, and fuller test coverage still remain before a production rollout. See [KNOWN-GAPS.md](KNOWN-GAPS.md) and [PRODUCTION-AUDIT-2026-05-03.md](PRODUCTION-AUDIT-2026-05-03.md) before launch.
