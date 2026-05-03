# Known Gaps

Proprietary software by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This system is not free to use.

- `support-service` and `chat-service` still remain placeholders and do not yet include runnable service code.
- The gateway now fails gracefully when support or chat upstreams are unavailable, but platform support, chat, and incident operations remain intentionally incomplete in the product surface.
- The SSR web app is implemented, but many browser flows still depend on the gateway and backend services being available together for a complete end-to-end experience.
- The newer customer-facing discovery experience is implemented, but the storefront still needs deeper personalization, richer review content, and fuller payment-shipping integration before it matches a mature production marketplace.
- Store logos currently use local-disk storage via `STORE_LOGO_UPLOAD_DIR`. A cloud object-storage adapter is still needed for shared production deployments.
- The current verification coverage is still lightweight and does not replace a full integration or browser test suite.
- See `docs/PRODUCTION-AUDIT-2026-05-03.md` for the stricter production-readiness gap classification and remediation order.
