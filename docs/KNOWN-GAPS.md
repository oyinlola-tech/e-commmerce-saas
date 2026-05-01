# Known Gaps

Proprietary software by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This system is not free to use.

- `support-service`, `chat-service`, and `notification-service` currently contain package metadata only and do not include runnable service code.
- The gateway already proxies support and chat paths, so those routes will not be fully operational until the missing services are implemented.
- `apps/web/app.js` is an SSR prototype backed by local state helpers rather than the full gateway and service mesh.
- There is no visible automated test suite or CI configuration in this repository snapshot.
