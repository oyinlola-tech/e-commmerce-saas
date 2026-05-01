# API Reference

Proprietary software by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This system is not free to use.

## Gateway

- `GET /health` - Gateway health response.
- `GET /metrics` - Prometheus-compatible gateway metrics.
- `GET /openapi.json` - Aggregated OpenAPI contract for the gateway surface.
- `GET /docs` - Swagger UI for the gateway and public platform APIs.
- `POST|GET /api/platform/auth/*` - Proxies platform auth traffic to `user-service`.
- `ANY /api/platform/stores/*` - Proxies platform store management to `store-service` for authenticated platform users.
- `ANY /api/platform/compliance/*` - Proxies compliance operations for platform users with owner, support, or store owner roles.
- `ANY /api/platform/support/*` - Reserved proxy target for `support-service`.
- `ANY /api/platform/chats/*` - Reserved proxy target for `chat-service`.
- `ANY /api/platform/billing/*` - Proxies subscription and billing flows to `billing-service`.
- `GET /api/platform/billing/plans` - Public plan catalog for owner subscriptions.
- `ANY /api/owner/stores/:storeId/products/*` - Owner-scoped proxy to `product-service`.
- `ANY /api/owner/stores/:storeId/orders/*` - Owner-scoped proxy to `order-service`.
- `ANY /api/owner/stores/:storeId/customers/*` - Owner-scoped proxy to `customer-service`.
- `ANY /api/owner/stores/:storeId/support/*` - Owner-scoped proxy to reserved `support-service`.
- `ANY /api/owner/stores/:storeId/chats/*` - Owner-scoped proxy to reserved `chat-service`.
- `ANY /api/owner/stores/:storeId/payments/*` - Owner-scoped proxy to `payment-service`.
- `ANY /api/owner/stores/:storeId/settings/*` - Owner-scoped proxy to `store-service`.
- `GET|POST|PUT|PATCH|DELETE /api/customers*` - Storefront customer flows via `customer-service`.
- `GET /api/products*` - Storefront product queries via `product-service`.
- `GET|POST|PATCH|DELETE /api/cart*` - Storefront cart flows via `cart-service`.
- `POST /api/checkout` - Checkout via `order-service`.
- `GET /api/orders*` - Customer order lookup via `order-service`.
- `ANY /api/chats*` - Reserved storefront chat proxy.
- `ANY /payments/*` - Public-facing mock/provider callback and webhook proxy to `payment-service`.

## User Service

- `POST /auth/register` - Creates a platform user and returns a JWT. Store owner registration publishes `USER_REGISTERED`.
- `POST /auth/login` - Authenticates a platform user and returns a JWT.
- `GET /auth/me` - Returns the authenticated platform user using signed internal headers.
- `POST /users` - Platform owner only. Creates backoffice users for supported roles.
- `GET /users` - Platform owner or support agent only. Returns platform user directory.

## Store Service

- `GET /resolve?host=` - Resolves a store by `custom_domain` or subdomain.
- `GET /stores/:id/access-check` - Verifies whether the current platform actor may access a store.
- `POST /stores` - Creates a store after billing eligibility passes.
- `GET /stores` - Lists all stores for staff or only owned stores for store owners.
- `GET /stores/:id` - Returns one store if the caller has access.
- `PUT /stores/:id` - Updates store metadata, theme, contact settings, activation, and SSL state.
- `GET /settings` - Returns the current store using the signed store context.
- `PUT /settings` - Reuses the store update path for the current signed store context.

## Compliance Service

- `POST /compliance/kyc` - Platform user KYC submission.
- `POST /compliance/kyb` - KYB submission tied to an owner and optionally a store.
- `POST /compliance/documents` - Upload metadata for KYC or KYB documents.
- `GET /compliance/me` - Returns the caller's KYC profile, KYB profile, documents, and reviews.
- `GET /compliance/submissions` - Returns submissions visible to the caller. Staff may inspect wider scope.
- `POST /compliance/reviews` - Platform owner or support agent only. Reviews KYC or KYB records and publishes compliance status changes.

## Customer Service

- `POST /customers/register` - Creates a customer for a store and returns a JWT.
- `POST /customers/login` - Authenticates a customer inside one store.
- `GET /customers/me` - Customer self profile lookup.
- `PUT /customers/me` - Customer self profile update.
- `GET /customers` - Platform user only. Lists customers for the signed store.

## Product Service

- `GET /products` - Lists products for the current store. Drafts are hidden from non-platform actors.
- `GET /products/id/:id` - Gets a product by numeric id for the current store.
- `GET /products/:slug` - Gets a product by slug for the current store.
- `POST /products` - Platform operator only. Creates a product and publishes `PRODUCT_CREATED`.
- `PUT /products/:id` - Platform operator only. Updates a product and publishes `PRODUCT_UPDATED`.
- `DELETE /products/:id` - Platform operator only. Soft deletes a product and publishes `PRODUCT_DELETED`.
- `POST /inventory/reservations` - Creates a reservation across product stock for checkout.
- `POST /inventory/reservations/:id/release` - Releases reserved stock.
- `POST /inventory/reservations/:id/commit` - Converts reserved stock into sold stock.

## Cart Service

- `GET /cart` - Finds or creates an active cart for a session or customer.
- `POST /cart/items` - Adds an item after resolving live product data from `product-service`.
- `PATCH /cart/items/:productId` - Changes cart item quantity or removes it when quantity becomes `0`.
- `DELETE /cart/items/:productId` - Removes an item from the cart.
- `POST /cart/clear` - Clears all items from the current active cart without destroying the cart identity.
- `POST /cart/merge` - Signed customer-only merge of an anonymous cart into a logged-in customer cart.

## Order Service

- `POST /checkout` - Customer-only signed checkout. Loads cart, reserves inventory, creates order rows, creates payment session, and publishes `ORDER_CREATED`.
- `GET /orders` - Lists orders for the signed customer or all store orders for platform actors.
- `GET /orders/:id` - Returns one order if the signed store and customer context match.
- `PATCH /orders/:id/status` - Platform user only. Updates status and publishes `ORDER_STATUS_CHANGED`.

## Payment Service

- `POST /payments/create-checkout-session` - Creates a pending storefront or subscription payment and returns provider payloads.
- `GET /payments/config` - Lists provider config for the signed store.
- `POST /payments/config` - Upserts one provider config for the signed store and encrypts the secret key.
- `POST /payments/webhooks/:provider` - Accepts webhook payloads, updates payment status, and publishes success or failure events with payment scope metadata.
- `POST /payments/mock/:provider/:reference` - Convenience path that routes into the webhook flow for local simulation.

## Billing Service

- `GET /plans` - Returns the platform subscription plan catalog.
- `GET /subscriptions/me` - Returns the signed owner's subscription.
- `GET /subscriptions/invoices` - Returns the signed owner's subscription invoices.
- `POST /subscriptions/checkout-session` - Creates a pending invoice and a subscription payment checkout session.
- `POST /subscriptions` - Creates or replaces a subscription and publishes `SUBSCRIPTION_CHANGED`.
- `POST /subscriptions/cancel` - Cancels immediately or marks the active subscription to end at the current period boundary.
- `GET /internal/subscriptions/check` - Returns whether an owner has an active or trialing subscription.
- `GET /subscriptions/:ownerId` - Platform owner or support agent only. Inspects another owner's subscription and latest invoice.

## Web Routes

- `GET /` - Platform landing page or storefront home depending on host.
- `GET|POST /signup` - Platform owner signup or storefront customer registration depending on host.
- `GET|POST /login` - Platform or storefront login depending on host.
- `GET /dashboard` - Owner dashboard.
- `POST /stores` - Owner-side store creation in the SSR prototype.
- `GET /platform-admin*` - Platform admin screens for tenant oversight, support, and incidents.
- `GET|POST /admin*` - Store admin screens for products, orders, settings, and domain setup.
- `GET /products`, `GET /products/:slug`, `GET /cart`, `GET /account`, `GET /orders`, `GET|POST /checkout` - Storefront flows served by the SSR prototype.

See package-level README files for per-package implementation notes.
