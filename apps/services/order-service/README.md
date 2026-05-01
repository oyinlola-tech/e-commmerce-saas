# Order Service

Proprietary software by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This package is not free to use.

## Purpose

`@aisle/order-service` turns carts into orders, coordinates inventory reservation and payment session creation, and exposes order lookup and status update flows.

## Runtime

- Default port: `4107`
- Entry point: `server.js`
- Routes: `src/routes.js`
- Schema: `src/schema.js`
- Consumers: `src/consumers.js`

## Main Capabilities

- Signed customer checkout flow.
- Store-scoped order listing and detail lookup.
- Platform-operator order status updates.
- Event-driven payment outcome handling for order confirmation or failure.

## Notes

- Publishes `ORDER_CREATED` and `ORDER_STATUS_CHANGED`.
- Consumes `PAYMENT_SUCCEEDED` and `PAYMENT_FAILED`.
