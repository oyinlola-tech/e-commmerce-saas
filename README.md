# Aisle Commerce SaaS

Proprietary software owned by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This repository is not free to use. No right to copy, modify, deploy, host, distribute, resell, sublicense, or reuse this codebase is granted without explicit written permission from Oluwayemi Oyinlola Michael.

## Project Summary

Aisle Commerce SaaS is a multi-tenant e-commerce platform organized as a Node.js monorepo. It combines:

- An Express SSR web experience for storefront, owner dashboard, and platform admin flows
- A gateway that resolves tenant hosts, verifies auth context, and proxies requests to bounded-context services
- Domain services for identity, stores, compliance, customers, products, carts, orders, payments, and billing
- A shared package for environment loading, database bootstrap, internal auth signing, JWT handling, HTTP helpers, logging, and event delivery

## Ownership and Usage

| Item | Value |
| --- | --- |
| Owner | Oluwayemi Oyinlola Michael |
| Portfolio | https://www.oyinlola.site/ |
| License metadata | `UNLICENSED` |
| Commercial status | Proprietary, not free to use |

See [LICENSE.md](LICENSE.md), [NOTICE.md](NOTICE.md), and [SECURITY.md](SECURITY.md) for repository usage and vulnerability reporting guidance.

## Monorepo Overview

| Path | Role |
| --- | --- |
| `apps/web` | Express SSR storefront, store admin, and platform admin prototype |
| `apps/gateway` | API gateway, tenant resolver, and reverse proxy |
| `apps/services/*` | Domain microservices grouped by bounded context |
| `packages/shared` | Shared runtime package used by gateway and services |
| `docs` | Detailed architecture, environment, API, data, and gap documentation |
| `.github/workflows` | Repository automation and security workflow definitions |

## Architecture Overview

### Runtime layers

| Layer | Main file(s) | Responsibility |
| --- | --- | --- |
| Web | `apps/web/app.js` | Renders storefront, owner, and platform admin pages |
| Gateway | `apps/gateway/server.js` | Resolves stores, reads tokens, signs internal headers, and proxies traffic |
| Services | `apps/services/*/server.js` | Own business logic and persistence per domain |
| Shared runtime | `packages/shared/src/*` | Common bootstrap, auth, DB, event, and utility code |

### High-level request flow

1. A browser request reaches the gateway on port `4000`.
2. The gateway checks whether the host is a platform host or a storefront host.
3. If store resolution is needed, the gateway calls `store-service /resolve`.
4. The gateway extracts a customer or platform token and verifies it.
5. The gateway builds signed internal headers with request, actor, and store context.
6. The request is proxied to the correct downstream service.
7. The target service validates the internal HMAC signature before trusting the request context.

### Event-driven behavior

| Event | Producer | Consumer | Purpose |
| --- | --- | --- | --- |
| `USER_REGISTERED` | `user-service` | `billing-service` | Provision trial subscription for new store owners |
| `ORDER_CREATED` | `order-service` | Reserved for future consumers | Signal successful order creation |
| `PAYMENT_SUCCEEDED` | `payment-service` | `order-service` | Confirm order and commit reserved inventory |
| `PAYMENT_FAILED` | `payment-service` | `order-service` | Mark order failed and release reserved inventory |
| `SUBSCRIPTION_CHANGED` | `billing-service` | Reserved for future consumers | Broadcast plan or status changes |
| `PRODUCT_*` | `product-service` | Reserved for future consumers | Broadcast catalog changes |
| `CART_UPDATED` | `cart-service` | Reserved for future consumers | Broadcast cart state changes |
| `COMPLIANCE_STATUS_CHANGED` | `compliance-service` | Reserved for future consumers | Broadcast KYC or KYB review outcome |

RabbitMQ is optional at runtime. If unavailable, the shared event bus falls back to a no-op publisher.

## Workspace and Service Inventory

| Component | Path | Default port | Status | Responsibility |
| --- | --- | --- | --- | --- |
| Web app | `apps/web` | `3000` | Implemented | SSR storefront, owner dashboard, and platform admin prototype |
| Gateway | `apps/gateway` | `4000` | Implemented | Host-aware reverse proxy and auth context bridge |
| User service | `apps/services/user-service` | `4101` | Implemented | Platform registration, login, and staff directory |
| Store service | `apps/services/store-service` | `4102` | Implemented | Store provisioning, lookup, domain resolution, and settings |
| Compliance service | `apps/services/compliance-service` | `4103` | Implemented | KYC, KYB, documents, and review workflow |
| Customer service | `apps/services/customer-service` | `4104` | Implemented | Store-scoped customer registration, login, and self-service |
| Product service | `apps/services/product-service` | `4105` | Implemented | Catalog CRUD and inventory reservations |
| Cart service | `apps/services/cart-service` | `4106` | Implemented | Guest and authenticated cart handling |
| Order service | `apps/services/order-service` | `4107` | Implemented | Checkout, order persistence, and order lifecycle |
| Payment service | `apps/services/payment-service` | `4108` | Implemented | Payment session creation, config, and webhooks |
| Billing service | `apps/services/billing-service` | `4109` | Implemented | Subscription lifecycle and eligibility checks |
| Support service | `apps/services/support-service` | `4110` | Placeholder package | Planned support workflow service |
| Chat service | `apps/services/chat-service` | `4111` | Placeholder package | Planned live chat and messaging service |
| Notification service | `apps/services/notification-service` | `4112` | Implemented | SMTP-backed outbound notification and email delivery service |
| Shared package | `packages/shared` | n/a | Implemented | Shared infrastructure and utilities |

## Root Workspace Scripts

| Command | Behavior |
| --- | --- |
| `npm start` | Starts the implemented services, gateway, and SSR web app together with `nodemon` restarts |
| `npm run start:once` | Starts the implemented services, gateway, and SSR web app together without `nodemon` |
| `npm run dev` | Starts the implemented services, gateway, and SSR web app together with `nodemon` restarts |
| `npm run start:browser` | Starts only the SSR web app plus gateway through the shared launcher |
| `npm run dev:browser` | Starts only the SSR web app plus gateway through the shared launcher with `nodemon` restarts |
| `npm run start:services` | Starts only the implemented services through the shared launcher |
| `npm run dev:services` | Starts only the implemented services through the shared launcher with `nodemon` restarts |
| `npm run start:frontend` | Starts only the SSR web app through the shared launcher |
| `npm run dev:frontend` | Starts only the SSR web app through the shared launcher with `nodemon` restarts |
| `npm run start:backend` | Starts only the gateway through the shared launcher |
| `npm run dev:backend` | Starts only the gateway through the shared launcher with `nodemon` restarts |
| `npm run start:web` | Starts the SSR web app |
| `npm run dev:web` | Starts the SSR web app with `nodemon` |
| `npm run start:gateway` | Starts the gateway directly |
| `npm run dev:gateway` | Starts the gateway directly with `nodemon` |
| `npm run start:user-service` | Starts `user-service` |
| `npm run dev:user-service` | Starts `user-service` with `nodemon` |
| `npm run start:store-service` | Starts `store-service` |
| `npm run dev:store-service` | Starts `store-service` with `nodemon` |
| `npm run start:compliance-service` | Starts `compliance-service` |
| `npm run dev:compliance-service` | Starts `compliance-service` with `nodemon` |
| `npm run start:customer-service` | Starts `customer-service` |
| `npm run dev:customer-service` | Starts `customer-service` with `nodemon` |
| `npm run start:product-service` | Starts `product-service` |
| `npm run dev:product-service` | Starts `product-service` with `nodemon` |
| `npm run start:cart-service` | Starts `cart-service` |
| `npm run dev:cart-service` | Starts `cart-service` with `nodemon` |
| `npm run start:order-service` | Starts `order-service` |
| `npm run dev:order-service` | Starts `order-service` with `nodemon` |
| `npm run start:payment-service` | Starts `payment-service` |
| `npm run dev:payment-service` | Starts `payment-service` with `nodemon` |
| `npm run start:billing-service` | Starts `billing-service` |
| `npm run dev:billing-service` | Starts `billing-service` with `nodemon` |
| `npm run start:support-service` | Reserved for future `support-service` implementation |
| `npm run start:chat-service` | Reserved for future `chat-service` implementation |
| `npm run start:notification-service` | Starts `notification-service` |
| `npm run dev:notification-service` | Starts `notification-service` with `nodemon` |
| `npm run swagger` | Starts a Swagger UI preview on `http://127.0.0.1:4015`, exports the gateway OpenAPI spec, and exposes the API request collection |
| `npm run swagger:export` | Writes the current gateway OpenAPI document to `docs/swagger/gateway.openapi.json` without starting the preview server |
| `npm run api:request -- --service <name> --path <route>` | Sends a signed internal request directly to a service for endpoints that are not exposed through the gateway |
| `npm run lint` | Runs the workspace ESLint configuration |
| `npm run smoke` | Probes health/docs/storefront endpoints for a lightweight end-to-end check |

## Infrastructure Requirements

| Dependency | Purpose | Notes |
| --- | --- | --- |
| MySQL | Primary persistence for implemented services | Required for implemented backend services |
| RabbitMQ | Event bus transport | Optional but needed for real event-driven behavior |
| Redis | Optional cache and rate-limit store | Used for cache and throttling when available, with in-memory fallback |
| External FX API | Currency conversion in SSR web app | Default base: `https://api.frankfurter.dev/v1` |
| External geolocation API | Currency/location context in SSR web app | Default base: `https://ipapi.co` |

## Environment Variables

### Shared service variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime mode |
| `PORT` | Service-specific | Listener port |
| `DATABASE_URL` | `mysql://root:password@127.0.0.1:3306/<service_db>` | MySQL connection |
| `JWT_SECRET` | Generated in development, required in production | JWT signing secret |
| `INTERNAL_SHARED_SECRET` | Generated in development, required in production | HMAC signing secret for internal requests |
| `RABBITMQ_URL` | `amqp://127.0.0.1:5672` | RabbitMQ connection string |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection string |
| `PLATFORM_ROOT_DOMAIN` | `aislecommerce.com` | Platform root domain |
| `EVENT_EXCHANGE` | `aisle.events` | RabbitMQ exchange name |
| `REQUEST_TIMEOUT_MS` | `5000` | Internal HTTP request timeout |
| `WEB_APP_URL` | `http://127.0.0.1:3000` | SSR web app base URL |
| `GATEWAY_URL` | `http://127.0.0.1:4000` | Gateway base URL |
| `COOKIE_SECURE` | `NODE_ENV === production` | Enables `Secure` cookies |
| `COOKIE_DOMAIN` | empty | Optional cookie domain override |
| `COOKIE_SAMESITE` | `lax` | SameSite mode for auth and session cookies |
| `STORE_LOGO_UPLOAD_DIR` | `<workspace>/uploads/logos` | Shared logo upload directory for store assets |
| `SWAGGER_PORT` | `4015` | Port used by `npm run swagger` for the standalone API explorer |
| `USER_SERVICE_URL` | `http://127.0.0.1:4101` | User service URL |
| `STORE_SERVICE_URL` | `http://127.0.0.1:4102` | Store service URL |
| `COMPLIANCE_SERVICE_URL` | `http://127.0.0.1:4103` | Compliance service URL |
| `CUSTOMER_SERVICE_URL` | `http://127.0.0.1:4104` | Customer service URL |
| `PRODUCT_SERVICE_URL` | `http://127.0.0.1:4105` | Product service URL |
| `CART_SERVICE_URL` | `http://127.0.0.1:4106` | Cart service URL |
| `ORDER_SERVICE_URL` | `http://127.0.0.1:4107` | Order service URL |
| `PAYMENT_SERVICE_URL` | `http://127.0.0.1:4108` | Payment service URL |
| `BILLING_SERVICE_URL` | `http://127.0.0.1:4109` | Billing service URL |
| `SUPPORT_SERVICE_URL` | `http://127.0.0.1:4110` | Planned support service URL |
| `CHAT_SERVICE_URL` | `http://127.0.0.1:4111` | Planned chat service URL |
| `NOTIFICATION_SERVICE_URL` | `http://127.0.0.1:4112` | Planned notification service URL |

### Web app variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime mode |
| `PORT` | `3000` | SSR web port |
| `PLATFORM_ROOT_DOMAIN` or `APP_ROOT_DOMAIN` | `localhost` | Hostname used to distinguish platform vs storefront requests |
| `STATE_SEED_ON_BOOT` | `false` | Demo state boot seeding flag |
| `COOKIE_SECRET` | Generated in development, required in production | Signed cookie secret for SSR state cookies |
| `CSRF_SECRET` | Generated in development, required in production | Double-submit CSRF secret for SSR forms |
| `IP_GEOLOCATION_API_BASE` | `https://ipapi.co` | Geolocation API base URL |
| `FX_RATES_API_BASE` | `https://api.frankfurter.dev/v1` | FX API base URL |
| `EXTERNAL_API_TIMEOUT_MS` | `2500` | Outbound request timeout |
| `BACKEND_REQUEST_TIMEOUT_MS` | `REQUEST_TIMEOUT_MS` fallback | Internal service timeout used by the SSR app |
| `STATIC_ASSET_CACHE_SECONDS` | `3600` | Cache lifetime for non-versioned static assets |
| `STORE_LOGO_UPLOAD_DIR` | `<workspace>/uploads/logos` | Local storage path for uploaded store logos |

## Security and Performance Highlights

- SSR forms now use double-submit CSRF protection. EJS forms should include `<input type="hidden" name="_csrf" value="<%= csrfToken %>">`.
- The gateway exposes `GET /api/csrf-token` for state-changing browser API calls that rely on cookies. Send the returned token in `X-CSRF-Token` or `_csrf`.
- The gateway CORS policy is now host-aware and restricted to trusted platform/store origins instead of `*`.
- Auth, session, and wishlist cookies are set with `HttpOnly`, `SameSite=Lax`, production `Secure`, and HTTPS-aware write guards.
- `helmet`, a stricter CSP, compression, static caching, request timeouts, and structured logging are enabled across the main entrypoints.
- Store logos are validated by size, MIME type, and magic bytes before being stored on disk for development use. Configure `STORE_LOGO_UPLOAD_DIR` if you do not want the default `<workspace>/uploads/logos` path.
- All request validation now returns field-level `422` responses for invalid payloads, and the gateway plus SSR flows reject unsafe redirects and untrusted hosts.

## Frontend and Owner Experience

- Store owners can upload a logo during signup or store settings updates, and the asset is served from `/logos/*` with long-lived cache headers.
- The storefront now includes a working wishlist flow, lazy-loaded commerce images, cached browser currency context, quick search, category and tag discovery, recently viewed products, and buy-again order actions.
- New demo merchandising templates and sample data are available for skincare, haircare, women-focused fashion, and unisex lifestyle storefronts so the customer experience feels more intentional for those categories.
- Platform admin pages, owner dashboards, and error pages are wired to usable placeholder data so demo navigation does not dead-end.

## How to Run the Repository

### Full service mesh

1. Install dependencies with `npm install`.
2. Ensure MySQL is available.
3. Start RabbitMQ if you want active event subscriptions.
4. Configure environment variables.
5. Run `npm run dev` for the full local stack, or use `npm run start:once` when you do not want `nodemon`.
6. On a fresh database, each implemented service will create its own tables and indexes from its `src/schema.js` file during startup. No separate migration step is required for first-time setup.
7. Use `npm run dev:browser` if you only want the web app plus gateway, or `npm run dev:services` if you only want the internal service mesh.
8. Run `npm run smoke` after startup if you want a quick health/docs/storefront probe.

### API docs and endpoint testing

1. Run `npm run swagger`.
2. Open `http://127.0.0.1:4015` for the standalone Swagger UI preview.
3. Use the gateway-hosted docs at `http://127.0.0.1:4000/docs` if the gateway is already running.
4. Download the exported spec from `docs/swagger/gateway.openapi.json` or `http://127.0.0.1:4015/openapi.json`.
5. Open `tests/aisle-api.http` in a REST Client-compatible editor to exercise the main gateway endpoints with ready-made requests.
6. Use `npm run api:request -- --service <name> --path <route>` when you need to hit an internal-only service endpoint with the required HMAC headers.

The Swagger preview also exposes:

- `GET /health` for preview status
- `GET /service-map` for resolved gateway, web, and downstream service URLs
- `GET /tests/aisle-api.http` for the bundled request collection

### Minimal UI preview

If you only want to preview the interface, use `npm run dev:browser` for the SSR app plus gateway, or `npm run dev:frontend` for just the SSR app with local state helpers and sample data.

### Deployment note

Docker-specific files and references are not part of this repository anymore. Local execution is expected through the workspace `npm` scripts, while deployment automation is handled separately.

## API Surface Overview

### Gateway

- `GET /api/csrf-token`
- Resolves store hostnames through `store-service`
- Extracts bearer or cookie tokens
- Applies role checks for platform, owner, and customer flows
- Proxies platform APIs, owner APIs, storefront APIs, and socket paths

### User service

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `POST /users`
- `GET /users`

### Store service

- `GET /resolve`
- `GET /stores/:id/access-check`
- `POST /stores`
- `GET /stores`
- `GET /stores/:id`
- `PUT /stores/:id`
- `POST /stores/:id/logo`
- `GET /settings`
- `PUT /settings`

### Compliance service

- `POST /compliance/kyc`
- `POST /compliance/kyb`
- `POST /compliance/documents`
- `GET /compliance/me`
- `GET /compliance/submissions`
- `POST /compliance/reviews`

### Customer service

- `POST /customers/register`
- `POST /customers/login`
- `GET /customers/me`
- `PUT /customers/me`
- `GET /customers`

### Product service

- `GET /products`
- `GET /products/id/:id`
- `GET /products/:slug`
- `POST /products`
- `PUT /products/:id`
- `DELETE /products/:id`
- `POST /inventory/reservations`
- `POST /inventory/reservations/:id/release`
- `POST /inventory/reservations/:id/commit`

### Cart service

- `GET /cart`
- `POST /cart/items`
- `PATCH /cart/items/:productId`
- `DELETE /cart/items/:productId`
- `POST /cart/clear`
- `POST /cart/merge`

### Order service

- `POST /checkout`
- `GET /orders`
- `GET /orders/:id`
- `PATCH /orders/:id/status`

### Payment service

- `POST /payments/create-checkout-session`
- `GET /payments/config`
- `POST /payments/config`
- `POST /payments/webhooks/:provider`
- `POST /payments/mock/:provider/:reference`

### Billing service

- `GET /subscriptions/me`
- `POST /subscriptions`
- `POST /subscriptions/cancel`
- `GET /internal/subscriptions/check`
- `GET /subscriptions/:ownerId`

## Data Ownership Summary

| Service | Main table(s) | Purpose |
| --- | --- | --- |
| User service | `platform_users` | Platform identities and roles |
| Store service | `stores` | Tenant records and store settings |
| Compliance service | `kyc_profiles`, `kyb_profiles`, `compliance_documents`, `compliance_reviews` | Identity and business compliance workflow |
| Customer service | `customers` | Store-scoped customer accounts |
| Product service | `products`, `inventory_reservations`, `inventory_reservation_items` | Catalog and stock locking |
| Cart service | `carts`, `cart_items` | Session and customer carts |
| Order service | `orders`, `order_items` | Order records and line items |
| Payment service | `payments`, `payment_provider_configs`, `payment_webhooks` | Payment attempts, provider config, webhook logs |
| Billing service | `subscriptions`, `invoices` | Subscription lifecycle and billing records |

## Shared Package Breakdown

| File | Responsibility |
| --- | --- |
| `packages/shared/src/constants.js` | Event names, roles, theme contracts, provider lists |
| `packages/shared/src/crypto.js` | Encryption helpers |
| `packages/shared/src/database.js` | MySQL database bootstrap and transaction helpers |
| `packages/shared/src/env.js` | Shared service environment loading and config shaping |
| `packages/shared/src/events.js` | RabbitMQ event bus with no-op fallback |
| `packages/shared/src/express.js` | Base Express app and pagination helpers |
| `packages/shared/src/http.js` | Internal HTTP request helper(s) |
| `packages/shared/src/internal-auth.js` | HMAC header signing and verification |
| `packages/shared/src/jwt.js` | JWT helpers for platform and customer auth |
| `packages/shared/src/logger.js` | Logging utilities |
| `packages/shared/src/passwords.js` | Password hashing and comparison helpers |
| `packages/shared/src/service-runner.js` | Standardized service bootstrap flow |

## Web App Breakdown

| Area | Purpose |
| --- | --- |
| `views/storefront` | Storefront pages such as home, product list, cart, checkout, account, and orders |
| `views/admin` | Store owner admin pages |
| `views/platform` | Platform dashboard and platform admin views |
| `views/layouts` | Layout shells for main, store, admin, and platform admin modes |
| `views/partials` | Shared EJS partials |
| `src/lib` | Currency, env, theme, and runtime state helpers |
| `src/data` | Seed and runtime data files for the SSR prototype |

## Complete Folder Structure

The tree below reflects the current project-owned repository structure and intentionally excludes `.git/` internals and `node_modules/` dependencies.

```text
.
+-- .github
|   \-- workflows
|       \-- codeql.yml
+-- apps
|   +-- gateway
|   |   +-- package.json
|   |   +-- README.md
|   |   \-- server.js
|   +-- services
|   |   +-- billing-service
|   |   |   +-- src
|   |   |   |   +-- consumers.js
|   |   |   |   +-- routes.js
|   |   |   |   \-- schema.js
|   |   |   +-- package.json
|   |   |   +-- README.md
|   |   |   \-- server.js
|   |   +-- cart-service
|   |   |   +-- src
|   |   |   |   +-- routes.js
|   |   |   |   \-- schema.js
|   |   |   +-- package.json
|   |   |   +-- README.md
|   |   |   \-- server.js
|   |   +-- chat-service
|   |   |   +-- package.json
|   |   |   \-- README.md
|   |   +-- compliance-service
|   |   |   +-- src
|   |   |   |   +-- routes.js
|   |   |   |   \-- schema.js
|   |   |   +-- package.json
|   |   |   +-- README.md
|   |   |   \-- server.js
|   |   +-- customer-service
|   |   |   +-- src
|   |   |   |   +-- routes.js
|   |   |   |   \-- schema.js
|   |   |   +-- package.json
|   |   |   +-- README.md
|   |   |   \-- server.js
|   |   +-- notification-service
|   |   |   +-- package.json
|   |   |   \-- README.md
|   |   +-- order-service
|   |   |   +-- src
|   |   |   |   +-- consumers.js
|   |   |   |   +-- routes.js
|   |   |   |   \-- schema.js
|   |   |   +-- package.json
|   |   |   +-- README.md
|   |   |   \-- server.js
|   |   +-- payment-service
|   |   |   +-- src
|   |   |   |   +-- routes.js
|   |   |   |   \-- schema.js
|   |   |   +-- package.json
|   |   |   +-- README.md
|   |   |   \-- server.js
|   |   +-- product-service
|   |   |   +-- src
|   |   |   |   +-- routes.js
|   |   |   |   \-- schema.js
|   |   |   +-- package.json
|   |   |   +-- README.md
|   |   |   \-- server.js
|   |   +-- store-service
|   |   |   +-- src
|   |   |   |   +-- routes.js
|   |   |   |   \-- schema.js
|   |   |   +-- package.json
|   |   |   +-- README.md
|   |   |   \-- server.js
|   |   +-- support-service
|   |   |   +-- package.json
|   |   |   \-- README.md
|   |   \-- user-service
|   |       +-- src
|   |       |   +-- routes.js
|   |       |   \-- schema.js
|   |       +-- package.json
|   |       +-- README.md
|   |       \-- server.js
|   \-- web
|       +-- public
|       |   +-- js
|       |   \-- styles
|       |       \-- theme.css
|       +-- src
|       |   +-- config
|       |   +-- data
|       |   |   +-- empty-state.js
|       |   |   +-- runtime-state.json
|       |   |   \-- seed.js
|       |   +-- lib
|       |   |   +-- currency.js
|       |   |   +-- load-env.js
|       |   |   +-- state.js
|       |   |   \-- store-themes.js
|       |   +-- middleware
|       |   +-- routes
|       |   \-- services
|       +-- views
|       |   +-- admin
|       |   |   +-- dashboard.ejs
|       |   |   +-- domain.ejs
|       |   |   +-- order-detail.ejs
|       |   |   +-- orders.ejs
|       |   |   +-- product-form.ejs
|       |   |   +-- products.ejs
|       |   |   \-- settings.ejs
|       |   +-- errors
|       |   |   +-- 404.ejs
|       |   |   \-- 500.ejs
|       |   +-- layouts
|       |   |   +-- admin.ejs
|       |   |   +-- main.ejs
|       |   |   +-- platform-admin.ejs
|       |   |   \-- store.ejs
|       |   +-- partials
|       |   |   +-- admin-scripts.ejs
|       |   |   +-- admin-sidebar.ejs
|       |   |   +-- admin-topbar.ejs
|       |   |   +-- flash.ejs
|       |   |   +-- form-error.ejs
|       |   |   +-- head.ejs
|       |   |   +-- platform-admin-sidebar.ejs
|       |   |   +-- platform-admin-topbar.ejs
|       |   |   +-- platform-footer.ejs
|       |   |   +-- platform-navbar.ejs
|       |   |   +-- scripts.ejs
|       |   |   +-- shared-scripts.ejs
|       |   |   +-- store-footer.ejs
|       |   |   \-- store-header.ejs
|       |   +-- platform
|       |   |   +-- admin-dashboard.ejs
|       |   |   +-- admin-incidents.ejs
|       |   |   +-- admin-stores.ejs
|       |   |   +-- admin-support.ejs
|       |   |   +-- dashboard.ejs
|       |   |   +-- index.ejs
|       |   |   +-- login.ejs
|       |   |   \-- signup.ejs
|       |   +-- platform-admin
|       |   \-- storefront
|       |       +-- account.ejs
|       |       +-- cart.ejs
|       |       +-- checkout.ejs
|       |       +-- home.ejs
|       |       +-- login.ejs
|       |       +-- order-confirmation.ejs
|       |       +-- orders.ejs
|       |       +-- product.ejs
|       |       +-- products.ejs
|       |       \-- register.ejs
|       +-- .env.development
|       +-- .env.production
|       +-- app.js
|       +-- package.json
|       \-- README.md
+-- docs
|   +-- API-REFERENCE.md
|   +-- ARCHITECTURE.md
|   +-- DATA-MODEL.md
|   +-- ENVIRONMENT.md
|   \-- KNOWN-GAPS.md
+-- packages
|   \-- shared
|       +-- src
|       |   +-- constants.js
|       |   +-- crypto.js
|       |   +-- database.js
|       |   +-- env.js
|       |   +-- events.js
|       |   +-- express.js
|       |   +-- http.js
|       |   +-- internal-auth.js
|       |   +-- jwt.js
|       |   +-- logger.js
|       |   +-- passwords.js
|       |   \-- service-runner.js
|       +-- index.js
|       +-- package.json
|       \-- README.md
+-- .gitignore
+-- LICENSE.md
+-- NOTICE.md
+-- package.json
+-- package-lock.json
\-- README.md
```

### Structure notes

- `apps/web/public/js`, `apps/web/src/config`, `apps/web/src/middleware`, `apps/web/src/routes`, `apps/web/src/services`, and `apps/web/views/platform-admin` currently exist as directories but do not yet contain committed implementation files in this snapshot.
- `apps/services/chat-service`, `apps/services/support-service`, and `apps/services/notification-service` are currently metadata-plus-documentation placeholders only.

## Known Gaps and Current Risks

- `support-service`, `chat-service`, and `notification-service` do not yet have runnable service code.
- The gateway already proxies support and chat routes, so those flows are not fully operational yet.
- `apps/web/app.js` is a prototype backed by local state helpers, not a full end-to-end gateway-backed interface for every flow.
- Store logos currently use local disk in development. A shared object-storage adapter is still needed for multi-instance production deployments.
- The smoke test and request collection improve coverage, but the repository still needs a broader integration and browser test suite for checkout, owner workflows, and payment-state transitions.

## Documentation Map

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)
- [docs/API-REFERENCE.md](docs/API-REFERENCE.md)
- [docs/DATA-MODEL.md](docs/DATA-MODEL.md)
- [docs/KNOWN-GAPS.md](docs/KNOWN-GAPS.md)
- [apps/gateway/README.md](apps/gateway/README.md)
- [apps/web/README.md](apps/web/README.md)
- [packages/shared/README.md](packages/shared/README.md)

## Final Note

This root `README.md` is intended to be the single high-level handbook for the repository. The package-level READMEs and the `docs/` directory remain available for focused, per-area reference, but the structure, architecture, runtime expectations, ownership, and current implementation state are all summarized here.
