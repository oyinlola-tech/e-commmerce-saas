# Environment

Proprietary software by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This system is not free to use.

## Loading Rules

- Shared services use `packages/shared/src/env.js`.
- Service processes look for `.env`, `.env.development`, `.env.development.local`, `.env.production`, and `.env.production.local` in both the workspace root and the app root.
- The SSR web app uses `apps/web/src/lib/load-env.js` and reads `.env*` files from both the workspace root and `apps/web`.
- `PLATFORM_ROOT_DOMAIN` must resolve to a valid hostname. Invalid host values are rejected at startup.

## Shared Variables

These variables are read globally by `createServiceConfig()` and, unless overridden by a service-specific prefix, apply to every backend service.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime mode |
| `PLATFORM_ROOT_DOMAIN` | `aislecommerce.com` | Main platform host/root domain |
| `WEB_APP_URL` | `http://127.0.0.1:3000` | Web app base URL |
| `GATEWAY_URL` | `http://127.0.0.1:4000` | Gateway base URL |
| `JWT_SECRET` | Generated in development, required in production | JWT signing secret |
| `JWT_ACCESS_TTL` | `1h` | Access-token lifetime for platform and customer JWTs |
| `INTERNAL_SHARED_SECRET` | Generated in development, required in production | HMAC secret for internal request headers |
| `COOKIE_SECRET` | Generated in development, required in production | SSR signed-cookie secret |
| `CSRF_SECRET` | Generated in development, required in production | CSRF secret for the SSR app |
| `COOKIE_SECURE` | `NODE_ENV === production` | Enables `Secure` cookies |
| `COOKIE_DOMAIN` | empty | Optional cookie domain override |
| `COOKIE_SAMESITE` | `lax` | SameSite mode for auth cookies |
| `INTERNAL_REQUEST_MAX_AGE_MS` | `300000` | Maximum accepted age for signed internal requests |
| `INTERNAL_REQUEST_NONCE_TTL_MS` | `300000` | Replay-protection nonce retention window |
| `RABBITMQ_URL` | `amqp://127.0.0.1:5672` | RabbitMQ connection |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection |
| `DISABLE_REDIS` | `false` | Forces in-memory cache/rate-limit fallback |
| `EVENT_EXCHANGE` | `aisle.events` | RabbitMQ topic exchange name |
| `DATABASE_READ_URLS` | empty | Global comma-separated read replica URLs fallback |
| `DB_POOL_MIN` | `2` | Minimum idle MySQL connections |
| `DB_POOL_MAX` | `12` | Maximum pooled MySQL connections |
| `DB_IDLE_TIMEOUT_MS` | `60000` | MySQL idle timeout |
| `DB_ACQUIRE_TIMEOUT_MS` | `10000` | MySQL acquire timeout |
| `DB_CONNECT_RETRIES` | `5` | Bootstrap retry count for MySQL |
| `DB_CONNECT_RETRY_DELAY_MS` | `1000` | Delay between MySQL bootstrap retries |
| `REQUEST_TIMEOUT_MS` | `5000` | Internal HTTP timeout |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Default global rate-limit window for services |
| `RATE_LIMIT_MAX` | `120` | Default global request cap for services |
| `MUTATION_RATE_LIMIT_WINDOW_MS` | `600000` | Default write-request limiter window |
| `MUTATION_RATE_LIMIT_MAX` | `60` | Default write-request limiter cap |
| `PAGE_CACHE_TTL_SECONDS` | `60` | Default cache TTL for short-lived page data |
| `STATIC_ASSET_CACHE_SECONDS` | `3600` | Cache TTL for non-versioned static assets |
| `STORE_LOGO_UPLOAD_DIR` | `<workspace>/uploads/logos` | Shared logo upload directory used by store-service and the SSR app |
| `SWAGGER_PORT` | `4015` | Port used by the standalone Swagger preview started with `npm run swagger` |
| `USER_SERVICE_URL` | `http://127.0.0.1:4101` | User service base URL |
| `STORE_SERVICE_URL` | `http://127.0.0.1:4102` | Store service base URL |
| `COMPLIANCE_SERVICE_URL` | `http://127.0.0.1:4103` | Compliance service base URL |
| `CUSTOMER_SERVICE_URL` | `http://127.0.0.1:4104` | Customer service base URL |
| `PRODUCT_SERVICE_URL` | `http://127.0.0.1:4105` | Product service base URL |
| `CART_SERVICE_URL` | `http://127.0.0.1:4106` | Cart service base URL |
| `ORDER_SERVICE_URL` | `http://127.0.0.1:4107` | Order service base URL |
| `PAYMENT_SERVICE_URL` | `http://127.0.0.1:4108` | Payment service base URL |
| `BILLING_SERVICE_URL` | `http://127.0.0.1:4109` | Billing service base URL |
| `SUPPORT_SERVICE_URL` | `http://127.0.0.1:4110` | Reserved support service URL |
| `CHAT_SERVICE_URL` | `http://127.0.0.1:4111` | Reserved chat service URL |
| `NOTIFICATION_SERVICE_URL` | `http://127.0.0.1:4112` | Notification service base URL |
| `SUBSCRIPTION_DEFAULT_CURRENCY` | `NGN` | Default billing currency for owner plans |
| `PAYSTACK_PLATFORM_PUBLIC_KEY` | empty | Public key used for platform subscription checkout |
| `PAYSTACK_PLATFORM_SECRET_KEY` | empty | Secret key used for platform subscription checkout |
| `FLUTTERWAVE_PLATFORM_PUBLIC_KEY` | empty | Public key used for platform subscription checkout |
| `FLUTTERWAVE_PLATFORM_SECRET_KEY` | empty | Secret key used for platform subscription checkout |

## Service-Scoped Variables

`packages/shared/src/env.js` resolves service-specific variables before global ones. Supported prefixes in this repo include `GATEWAY`, `USER_SERVICE`, `STORE_SERVICE`, `COMPLIANCE_SERVICE`, `CUSTOMER_SERVICE`, `PRODUCT_SERVICE`, `CART_SERVICE`, `ORDER_SERVICE`, `PAYMENT_SERVICE`, `BILLING_SERVICE`, and `NOTIFICATION_SERVICE`.

| Variable Pattern | Purpose |
| --- | --- |
| `<PREFIX>_PORT` | Listener port for that service |
| `<PREFIX>_DATABASE_URL` | Full MySQL URL override for that service |
| `<PREFIX>_DATABASE_HOST` | MySQL host when building the URL from parts |
| `<PREFIX>_DATABASE_PORT` | MySQL port when building the URL from parts |
| `<PREFIX>_DATABASE_USER` | MySQL username when building the URL from parts |
| `<PREFIX>_DATABASE_PASSWORD` | MySQL password when building the URL from parts |
| `<PREFIX>_DATABASE_NAME` | MySQL database name when building the URL from parts |
| `<PREFIX>_DATABASE_CHARSET` | Optional MySQL charset query parameter |
| `<PREFIX>_DATABASE_TIMEZONE` | Optional MySQL timezone query parameter |
| `<PREFIX>_DATABASE_CONNECT_TIMEOUT_MS` | Optional MySQL connect timeout query parameter |
| `<PREFIX>_DATABASE_READ_URLS` | Read-replica URLs override for that service |
| `<PREFIX>_DB_POOL_MIN` / `<PREFIX>_DB_POOL_MAX` | Pool sizing override for that service |
| `<PREFIX>_DB_IDLE_TIMEOUT_MS` / `<PREFIX>_DB_ACQUIRE_TIMEOUT_MS` | Pool timeout overrides for that service |
| `<PREFIX>_DB_CONNECT_RETRIES` / `<PREFIX>_DB_CONNECT_RETRY_DELAY_MS` | Connection bootstrap retry overrides |
| `<PREFIX>_JWT_SECRET` / `<PREFIX>_JWT_ACCESS_TTL` | JWT override for a specific service |
| `<PREFIX>_INTERNAL_SHARED_SECRET` | Internal HMAC secret override for a specific service |
| `<PREFIX>_REQUEST_TIMEOUT_MS` | Internal HTTP timeout override |
| `<PREFIX>_REDIS_PREFIX` | Redis namespace override |
| `<PREFIX>_INTERNAL_REQUEST_MAX_AGE_MS` / `<PREFIX>_INTERNAL_REQUEST_NONCE_TTL_MS` | Signed-request validation override |
| `<PREFIX>_PAGE_CACHE_TTL_SECONDS` / `<PREFIX>_STATIC_ASSET_CACHE_SECONDS` | Cache TTL override |
| `<PREFIX>_RATE_LIMIT_WINDOW_MS` / `<PREFIX>_RATE_LIMIT_MAX` | Global request limiter override |
| `<PREFIX>_AUTH_RATE_LIMIT_WINDOW_MS` / `<PREFIX>_AUTH_RATE_LIMIT_MAX` | Auth-route limiter override |
| `<PREFIX>_MUTATION_RATE_LIMIT_WINDOW_MS` / `<PREFIX>_MUTATION_RATE_LIMIT_MAX` | Write-route limiter override |

If `<PREFIX>_DATABASE_URL` is omitted but any of the `<PREFIX>_DATABASE_*` parts are present, the service builds the MySQL URL automatically. This lets you inject the host, port, username, password, and database name directly from `.env`.

## Web App Variables

The SSR app reads `WEB_*` first, then `WEB_APP_*`, then falls back to unscoped shared variables when appropriate.

| Variable | Default | Purpose |
| --- | --- | --- |
| `WEB_PORT` | `3000` | Web app port |
| `PLATFORM_ROOT_DOMAIN` or `APP_ROOT_DOMAIN` | `localhost` | Hostname used to distinguish platform versus storefront routes |
| `JWT_SECRET` | Generated in development, required in production | JWT secret used by the SSR app for signed auth flows |
| `INTERNAL_SHARED_SECRET` | Generated in development, required in production | Shared signing secret when the web app talks to services directly |
| `COOKIE_SECRET` | Generated in development, required in production | Secret for signed SSR cookies |
| `CSRF_SECRET` | Generated in development, required in production | Secret used by the double-submit CSRF middleware |
| `COOKIE_SECURE` | `NODE_ENV === production` | Enables `Secure` SSR cookies |
| `COOKIE_DOMAIN` | empty | Optional cookie domain override |
| `COOKIE_SAMESITE` | `lax` | SameSite mode for SSR cookies |
| `IP_GEOLOCATION_API_BASE` | `https://ipapi.co` | Geolocation API base URL |
| `FX_RATES_API_BASE` | `https://api.frankfurter.dev/v1` | Currency conversion API base URL |
| `EXTERNAL_API_TIMEOUT_MS` | `2500` | Outbound request timeout |
| `BACKEND_REQUEST_TIMEOUT_MS` | `REQUEST_TIMEOUT_MS` fallback | Timeout for SSR-to-service HTTP requests |
| `WEB_RATE_LIMIT_WINDOW_MS` / `WEB_RATE_LIMIT_MAX` | `60000` / `180` in the example file | Page request limiter |
| `WEB_AUTH_RATE_LIMIT_WINDOW_MS` / `WEB_AUTH_RATE_LIMIT_MAX` | `900000` / `5` in the example file | Login and auth action limiter |
| `WEB_AUTH_PAGE_RATE_LIMIT_WINDOW_MS` / `WEB_AUTH_PAGE_RATE_LIMIT_MAX` | `900000` / `20` in the example file | Login page render limiter |
| `WEB_MUTATION_RATE_LIMIT_WINDOW_MS` / `WEB_MUTATION_RATE_LIMIT_MAX` | `600000` / `45` in the example file | Write-request limiter |
| `STATIC_ASSET_CACHE_SECONDS` | `3600` | Cache lifetime for non-versioned assets |
| `STORE_LOGO_UPLOAD_DIR` | `<workspace>/uploads/logos` | Local logo upload directory |
| `USER_SERVICE_URL` | `http://127.0.0.1:4101` | Direct service URL for web-only flows |
| `STORE_SERVICE_URL` | `http://127.0.0.1:4102` | Direct service URL for web-only flows |
| `CUSTOMER_SERVICE_URL` | `http://127.0.0.1:4104` | Direct service URL for web-only flows |
| `PRODUCT_SERVICE_URL` | `http://127.0.0.1:4105` | Direct service URL for web-only flows |
| `CART_SERVICE_URL` | `http://127.0.0.1:4106` | Direct service URL for web-only flows |
| `ORDER_SERVICE_URL` | `http://127.0.0.1:4107` | Direct service URL for web-only flows |
| `PAYMENT_SERVICE_URL` | `http://127.0.0.1:4108` | Direct service URL for store payment-config flows |
| `BILLING_SERVICE_URL` | `http://127.0.0.1:4109` | Direct service URL for web-only flows |

## Payment Key Notes

- `PAYSTACK_PLATFORM_*` and `FLUTTERWAVE_PLATFORM_*` are only for platform subscription billing.
- Store owners should configure storefront provider keys in the store admin settings page.
- Storefront public keys can be rendered client-side for checkout, but storefront secret keys are stored server-side and never returned by the payment configuration endpoints.

## Security Notes

- Development defaults now generate random JWT, internal HMAC, cookie, and CSRF secrets when those variables are omitted. Production must set `JWT_SECRET`, `INTERNAL_SHARED_SECRET`, `COOKIE_SECRET`, and `CSRF_SECRET` explicitly, and should set the platform payment secrets before enabling subscription billing.
- SSR forms include a `_csrf` field, while browser API clients should fetch `GET /api/csrf-token` from the gateway and send the returned token in `X-CSRF-Token`. The same gateway token is now required for browser-driven state-changing `/payments/*` requests except webhook callbacks and signed internal service calls.
- Sensitive cookies are only written on secure requests in production. Make sure TLS termination forwards `X-Forwarded-Proto=https` and that `trust proxy` remains enabled.
- `STORE_LOGO_UPLOAD_DIR` should point at persistent storage in shared or production deployments. Local disk is the development fallback only.

## API Testing Notes

- `npm run swagger` starts a standalone Swagger UI preview on `http://127.0.0.1:4015` and exports `docs/swagger/gateway.openapi.json`.
- `npm run api:request -- --service <name> --path <route>` sends signed internal requests directly to a service when the route is intentionally not gateway-exposed.
- If you change `SWAGGER_PORT`, the standalone preview URLs move with it, but the gateway-hosted docs remain at `/docs` on the gateway base URL.

## Infrastructure Expectations

- MySQL is required for implemented services.
- RabbitMQ is optional but enables event-driven automation.
- Redis now backs cache plus gateway and shared-service rate limiting when available, with an in-memory fallback for local development.
- The payment service supports provider configuration, payment verification, and webhook-driven status updates for storefront and subscription billing flows.
- For first-time environments, the implemented services bootstrap their own tables and indexes from `apps/services/*/src/schema.js` when they start.

## Recommended Local Startup Order

1. MySQL
2. RabbitMQ
3. Gateway and implemented services
4. SSR web app

For the full local stack, `npm start`, `npm run start:once`, and `npm run dev` start the implemented services together with the gateway and SSR web app.

For the browser-facing layer only, use `npm run start:browser` or `npm run dev:browser`.

`npm run start:frontend` and `npm run dev:frontend` start only the SSR process. They are useful for view-layer and asset work, but most commerce flows still need the gateway and backend services running.
