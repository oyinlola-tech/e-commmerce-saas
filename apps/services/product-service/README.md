# Product Service

Proprietary software by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This package is not free to use.

## Purpose

`@aisle/product-service` owns the product catalog and the inventory reservation workflow used during checkout.

## Runtime

- Default port: `4105`
- Entry point: `server.js`
- Routes: `src/routes.js`
- Schema: `src/schema.js`

## Main Capabilities

- Store-scoped product listing and lookup by id or slug.
- Platform-operator product create, update, and soft delete flows.
- Reservation, release, and commit operations for inventory.
- Availability calculations using `inventory_count` and `reserved_count`.

## Notes

- Publishes `PRODUCT_CREATED`, `PRODUCT_UPDATED`, and `PRODUCT_DELETED`.
- Reservation rows are stored in dedicated inventory reservation tables.
