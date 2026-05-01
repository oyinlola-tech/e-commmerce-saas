# Environment

Proprietary software by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This system is not free to use.

## Loading Rules

- Shared services use `packages/shared/src/env.js`.
- Service processes look for `.env`, `.env.development`, `.env.development.local`, `.env.production`, and `.env.production.local` in both the workspace root and the app root.
- The SSR web app uses `apps/web/src/lib/load-env.js` and reads `.env*` files from the `apps/web` root.

## Shared Service Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime mode |
| `PORT` | Service-specific | Listener port |
| `DATABASE_URL` | `mysql://root:password@127.0.0.1:3306/<service_db>` | MySQL connection string |
| `JWT_SECRET` | `aisle-jwt-secret` | JWT signing secret |
| `INTERNAL_SHARED_SECRET` | `aisle-internal-secret` | HMAC secret for internal headers |
| `RABBITMQ_URL` | `amqp://127.0.0.1:5672` | RabbitMQ connection |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection |
| `PLATFORM_ROOT_DOMAIN` | `aislecommerce.com` | Main platform host/root domain |
| `EVENT_EXCHANGE` | `aisle.events` | RabbitMQ topic exchange name |
| `REQUEST_TIMEOUT_MS` | `5000` | Internal HTTP timeout |
| `WEB_APP_URL` | `http://127.0.0.1:3000` | Web app base URL |
| `GATEWAY_URL` | `http://127.0.0.1:4000` | Gateway base URL |
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

## Web App Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime mode |
| `PORT` | `3000` | Web app port |
| `APP_ROOT_DOMAIN` | `localhost` | Hostname used to distinguish platform versus storefront routes |
| `STATE_SEED_ON_BOOT` | `false` | Toggles demo state seeding |
| `IP_GEOLOCATION_API_BASE` | `https://ipapi.co` | Geolocation API base URL |
| `FX_RATES_API_BASE` | `https://api.frankfurter.dev/v1` | Currency conversion API base URL |
| `EXTERNAL_API_TIMEOUT_MS` | `2500` | Outbound request timeout |

## Infrastructure Expectations

- MySQL is required for implemented services.
- RabbitMQ is optional but enables event-driven automation.
- Redis is configured in shared env defaults, although no implemented service in this snapshot depends on it directly for core flows.
- The payment service currently simulates providers and does not contain real provider SDK integrations.

## Recommended Local Startup Order

1. MySQL
2. RabbitMQ
3. Gateway and implemented services
4. SSR web app

If you only need interface previews, the web app can be run by itself because it uses local state helpers instead of the service mesh.
