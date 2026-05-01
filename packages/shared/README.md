# Shared Package

Proprietary software by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This package is not free to use.

## Purpose

`@aisle/shared` holds the reusable runtime primitives used by the gateway and implemented services.

## Main Modules

- `src/env.js` - Environment discovery and normalized service config creation.
- `src/database.js` - MySQL database bootstrap and transaction helpers.
- `src/events.js` - RabbitMQ event bus with no-op fallback.
- `src/internal-auth.js` - HMAC signing and verification for internal requests.
- `src/jwt.js` - JWT helpers for platform and customer tokens.
- `src/express.js` - Base Express app creation and pagination helpers.
- `src/constants.js` - Event names, roles, theme contracts, and payment provider lists.
- `src/service-runner.js` - Standard service bootstrap pipeline.

## Notes

- This package is the foundation for service startup, trust boundaries, and event flow.
- `src/service-runner.js` passes each service's `schemaStatements` into `src/database.js`, so fresh databases are created directly from the service schema files.
- Architecture details live in [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md).
