# Environment

Proprietary software by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This system is not free to use.

## Loading Rules

- Shared services use `packages/shared/src/env.js`.
- Service processes look for `.env`, `.env.development`, `.env.development.local`, `.env.production`, and `.env.production.local` in both the workspace root and the app root.
- The SSR web app uses `apps/web/src/lib/load-env.js` and reads `.env*` files from both the workspace root and `apps/web`.
- `PLATFORM_ROOT_DOMAIN` must resolve to a valid hostname. Invalid host values are rejected at startup.

## Shared Service Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime mode |
| `PORT` | Service-specific | Listener port |
| `DATABASE_URL` | `mysql://root:password@127.0.0.1:3306/<service_db>` | MySQL connection string |
| `DATABASE_READ_URLS` | empty | Comma-separated read replica MySQL URLs |
| `DB_POOL_MIN` | `2` | Minimum idle MySQL connections |
| `DB_POOL_MAX` | `12` | Maximum pooled MySQL connections |
| `DB_IDLE_TIMEOUT_MS` | `60000` | MySQL idle timeout |
| `DB_ACQUIRE_TIMEOUT_MS` | `10000` | MySQL acquire timeout |
| `DB_CONNECT_RETRIES` | `5` | Bootstrap retry count for MySQL |
| `DB_CONNECT_RETRY_DELAY_MS` | `1000` | Delay between MySQL bootstrap retries |
| `JWT_SECRET` | Generated in development, required in production | JWT signing secret |
| `JWT_ACCESS_TTL` | `1h` | Access-token lifetime for platform and customer JWTs |
| `INTERNAL_SHARED_SECRET` | Generated in development, required in production | HMAC secret for internal headers |
| `INTERNAL_REQUEST_MAX_AGE_MS` | `300000` | Maximum accepted age for signed internal requests |
| `INTERNAL_REQUEST_NONCE_TTL_MS` | `300000` | Replay-protection nonce retention window |
| `RABBITMQ_URL` | `amqp://127.0.0.1:5672` | RabbitMQ connection |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection |
| `DISABLE_REDIS` | `false` | Forces in-memory cache/rate-limit fallback |
| `REDIS_PREFIX` | `aisle:<serviceName>` | Shared cache and rate-limit key prefix |
| `PLATFORM_ROOT_DOMAIN` | `aislecommerce.com` | Main platform host/root domain |
| `EVENT_EXCHANGE` | `aisle.events` | RabbitMQ topic exchange name |
| `REQUEST_TIMEOUT_MS` | `5000` | Internal HTTP timeout |
| `WEB_APP_URL` | `http://127.0.0.1:3000` | Web app base URL |
| `GATEWAY_URL` | `http://127.0.0.1:4000` | Gateway base URL |
| `COOKIE_SECURE` | `NODE_ENV === production` | Enables `Secure` cookies |
| `COOKIE_DOMAIN` | empty | Optional cookie domain override |
| `COOKIE_SAMESITE` | `lax` | SameSite mode for auth cookies |
| `STORE_LOGO_UPLOAD_DIR` | `<workspace>/uploads/logos` | Shared logo upload directory used by store-service and the SSR app |
| `SWAGGER_PORT` | `4015` | Port used by the standalone Swagger preview started with `npm run swagger` |
| `GATEWAY_RATE_LIMIT_MAX` | `300` | Global per-minute gateway request limit |
| `GATEWAY_AUTH_RATE_LIMIT_MAX` | `20` | Auth-route rate limit window cap |
| `PAGE_CACHE_TTL_SECONDS` | `60` | Default cache TTL for short-lived gateway/service page data |
| `STATIC_ASSET_CACHE_SECONDS` | `3600` | Cache TTL for non-versioned static assets |
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
| `NOTIFICATION_SERVICE_URL` | `http://127.0.0.1:4112` | Reserved notification service URL |
| `SUBSCRIPTION_DEFAULT_CURRENCY` | `NGN` | Default billing currency for owner plans |
| `PAYSTACK_PLATFORM_PUBLIC_KEY` | empty | Public key used for platform subscription checkout |
| `FLUTTERWAVE_PLATFORM_PUBLIC_KEY` | empty | Public key used for platform subscription checkout |

## Web App Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime mode |
| `PORT` | `3000` | Web app port |
| `PLATFORM_ROOT_DOMAIN` or `APP_ROOT_DOMAIN` | `localhost` | Hostname used to distinguish platform versus storefront routes |
| `STATE_SEED_ON_BOOT` | `false` | Toggles demo state seeding |
| `JWT_SECRET` | Generated in development, required in production | SSR demo token secret |
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
| `STATIC_ASSET_CACHE_SECONDS` | `3600` | Cache lifetime for non-versioned assets |
| `STORE_LOGO_UPLOAD_DIR` | `<workspace>/uploads/logos` | Local logo upload directory |
| `USER_SERVICE_URL` | `http://127.0.0.1:4101` | Direct service URL for web-only flows |
| `STORE_SERVICE_URL` | `http://127.0.0.1:4102` | Direct service URL for web-only flows |
| `CUSTOMER_SERVICE_URL` | `http://127.0.0.1:4104` | Direct service URL for web-only flows |
| `PRODUCT_SERVICE_URL` | `http://127.0.0.1:4105` | Direct service URL for web-only flows |
| `CART_SERVICE_URL` | `http://127.0.0.1:4106` | Direct service URL for web-only flows |
| `ORDER_SERVICE_URL` | `http://127.0.0.1:4107` | Direct service URL for web-only flows |
| `BILLING_SERVICE_URL` | `http://127.0.0.1:4109` | Direct service URL for web-only flows |

## Security Notes

- Development defaults now generate random JWT, internal HMAC, cookie, and CSRF secrets when those variables are omitted. Production must set `JWT_SECRET`, `INTERNAL_SHARED_SECRET`, `COOKIE_SECRET`, and `CSRF_SECRET` explicitly.
- SSR forms include a `_csrf` field, while browser API clients should fetch `GET /api/csrf-token` from the gateway and send the returned token in `X-CSRF-Token`.
- Sensitive cookies are only written on secure requests in production. Make sure TLS termination forwards `X-Forwarded-Proto=https` and that `trust proxy` remains enabled.
- `STORE_LOGO_UPLOAD_DIR` should point at persistent storage in shared or production deployments. Local disk is the development fallback only.

## API Testing Notes

- `npm run swagger` starts a standalone Swagger UI preview on `http://127.0.0.1:4015` and exports `docs/swagger/gateway.openapi.json`.
- `tests/aisle-api.http` contains ready-made gateway requests for health, auth, compliance, billing, customer, cart, checkout, and owner flows.
- `npm run api:request -- --service <name> --path <route>` sends signed internal requests directly to a service when the route is intentionally not gateway-exposed.
- If you change `SWAGGER_PORT`, the standalone preview URLs move with it, but the gateway-hosted docs remain at `/docs` on the gateway base URL.

## Infrastructure Expectations

- MySQL is required for implemented services.
- RabbitMQ is optional but enables event-driven automation.
- Redis now backs cache and gateway rate limiting when available, with an in-memory fallback for local development.
- The payment service still uses mock checkout/webhook URLs, but now supports both storefront payments and platform subscription billing flows.
- For first-time environments, the implemented services bootstrap their own tables and indexes from `apps/services/*/src/schema.js` when they start.

## Recommended Local Startup Order

1. MySQL
2. RabbitMQ
3. Gateway and implemented services
4. SSR web app

If you only need interface previews, the web app can be run by itself because it uses local state helpers instead of the service mesh.
