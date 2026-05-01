# Store Service

Proprietary software by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This package is not free to use.

## Purpose

`@aisle/store-service` owns tenant records, store identity, theme settings, domain mapping, and access checks.

## Runtime

- Default port: `4102`
- Entry point: `server.js`
- Routes: `src/routes.js`
- Schema: `src/schema.js`

## Main Capabilities

- Resolve a store by subdomain or custom domain.
- Create stores after subscription eligibility passes through `billing-service`.
- List and fetch stores with role-aware access rules.
- Update store metadata, activation state, and SSL status.
- Return store-scoped settings based on signed internal context.

## Notes

- Publishes `STORE_CREATED` and `STORE_UPDATED`.
- See [../../../docs/API-REFERENCE.md](../../../docs/API-REFERENCE.md) and [../../../docs/DATA-MODEL.md](../../../docs/DATA-MODEL.md).
