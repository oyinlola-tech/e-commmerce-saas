# Gateway

Proprietary software by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This package is not free to use.

## Purpose

`@aisle/gateway` is the edge service for the platform. It resolves store hostnames, validates platform and customer JWTs, builds signed internal headers, checks store ownership access, and proxies requests to downstream services and the SSR web app.

## Runtime

- Default port: `4000`
- Entry point: `server.js`
- Main dependencies: `http-proxy-middleware`, `helmet`, `cors`, `express-rate-limit`

## Main Responsibilities

- Host-aware store resolution through `store-service`.
- Authentication context extraction from bearer tokens and cookies.
- Role-aware access for platform, owner, and customer paths.
- Signed service-to-service header propagation.
- Swagger and OpenAPI delivery through `/docs` and `/openapi.json`.
- Gateway metrics exposure through `/metrics`.
- Proxying for platform APIs, storefront APIs, and reserved socket paths.
- Public payment callback and mock-checkout proxying through `/payments/*`.

## Notes

- Detailed endpoint coverage lives in [../../docs/API-REFERENCE.md](../../docs/API-REFERENCE.md).
- The OpenAPI contract is generated in `src/openapi.js` and served from the running gateway.
- Current implementation gaps are tracked in [../../docs/KNOWN-GAPS.md](../../docs/KNOWN-GAPS.md).
