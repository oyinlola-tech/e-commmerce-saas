# Known Gaps

Proprietary software by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This system is not free to use.

- `support-service` and `chat-service` still remain placeholders and do not yet include runnable service code.
- The gateway now fails gracefully when support or chat upstreams are unavailable, and notification delivery still depends on valid SMTP configuration.
- The SSR web app is implemented, but many browser flows still depend on the gateway and backend services being available together for a complete end-to-end experience.
- The newer customer-facing discovery experience is demo-ready, but the storefront still needs deeper personalization, richer review content, and fuller payment-shipping integration before it matches a mature production marketplace.
- Store logos currently use local-disk storage via `STORE_LOGO_UPLOAD_DIR`. A cloud object-storage adapter is still needed for shared production deployments.
- The Swagger preview and `tests/aisle-api.http` make endpoint testing much easier, but the smoke test is still intentionally lightweight and does not replace a full integration or browser test suite.
