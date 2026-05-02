# Payment Service

Proprietary software by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This package is not free to use.

## Purpose

`@aisle/payment-service` stores payment attempts, manages store payment-provider configuration, and receives webhook-style payment outcomes.

## Runtime

- Default port: `4108`
- Entry point: `server.js`
- Routes: `src/routes.js`
- Schema: `src/schema.js`

## Main Capabilities

- Create checkout payment sessions with provider payloads.
- Store per-provider public and encrypted secret configuration.
- Record webhook payloads and update payment status.
- Publish payment success and failure events for downstream services.

## Notes

- Supported providers are currently `paystack` and `flutterwave`.
- The service accepts provider webhooks and records verified payment outcomes.
