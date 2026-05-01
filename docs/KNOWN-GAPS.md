# Known Gaps

Proprietary software by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This system is not free to use.

- `support-service`, `chat-service`, and `notification-service` currently contain package metadata only and do not include runnable service code.
- The gateway already proxies support and chat paths, so those routes will not be fully operational until the missing services are implemented.
- `order-service` attempts to call `POST /cart/clear` during checkout, but `cart-service` does not currently expose that route.
- `apps/web/app.js` is an SSR prototype backed by local state helpers rather than the full gateway and service mesh.
- `apps/gateway/server.js` calls `crypto.randomUUID()` without importing the `crypto` module.
- There is no visible automated test suite or CI configuration in this repository snapshot.
- Redis is configured in shared defaults, but implemented services in this snapshot do not yet demonstrate a concrete Redis-backed runtime feature.
