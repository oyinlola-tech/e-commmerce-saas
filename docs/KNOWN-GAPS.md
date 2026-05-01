# Known Gaps

Proprietary software by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This system is not free to use.

- `support-service`, `chat-service`, and `notification-service` still contain package metadata only and do not include runnable service code.
- The gateway now fails gracefully when support, chat, or notification upstreams are unavailable, but those features remain placeholders until the missing services are implemented.
- `apps/web/app.js` still serves as an SSR prototype backed largely by local state helpers rather than the full gateway and service mesh, even though CSRF, wishlist, logo upload, and admin/demo flows are now wired up.
- The newer customer-facing discovery experience is demo-ready, but the storefront still needs deeper personalization, richer review content, and fuller payment-shipping integration before it matches a mature production marketplace.
- Store logos currently use local-disk storage via `STORE_LOGO_UPLOAD_DIR`. A cloud object-storage adapter is still needed for shared production deployments.
- The Swagger preview and `tests/aisle-api.http` make endpoint testing much easier, but the smoke test is still intentionally lightweight and does not replace a full integration or browser test suite.
