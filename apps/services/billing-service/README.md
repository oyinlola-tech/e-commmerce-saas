# Billing Service

Proprietary software by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This package is not free to use.

## Purpose

`@aisle/billing-service` manages owner subscriptions and store-creation eligibility checks.

## Runtime

- Default port: `4109`
- Entry point: `server.js`
- Routes: `src/routes.js`
- Schema: `src/schema.js`
- Consumers: `src/consumers.js`

## Main Capabilities

- Owner subscription lookup.
- Subscription creation and replacement.
- Owner-initiated cancellation.
- Internal eligibility check used by `store-service`.
- Automatic trial provisioning when a store owner registers.

## Notes

- Consumes `USER_REGISTERED`.
- Publishes `SUBSCRIPTION_CHANGED`.
