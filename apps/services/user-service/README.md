# User Service

Proprietary software by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This package is not free to use.

## Purpose

`@aisle/user-service` manages platform identities for store owners, platform owners, and support agents.

## Runtime

- Default port: `4101`
- Entry point: `server.js`
- Routes: `src/routes.js`
- Schema: `src/schema.js`

## Main Capabilities

- Platform registration with password hashing and JWT issuance.
- Platform login with password verification.
- Authenticated `me` lookup for platform users.
- Platform-owner creation of backoffice users.
- Staff directory lookup for platform owners and support agents.

## Notes

- Store owner registration publishes `USER_REGISTERED`.
- See [../../../docs/API-REFERENCE.md](../../../docs/API-REFERENCE.md) and [../../../docs/DATA-MODEL.md](../../../docs/DATA-MODEL.md).
