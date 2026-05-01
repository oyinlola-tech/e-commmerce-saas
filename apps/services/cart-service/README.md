# Cart Service

Proprietary software by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This package is not free to use.

## Purpose

`@aisle/cart-service` manages guest and customer carts, item snapshots, and cart merge behavior.

## Runtime

- Default port: `4106`
- Entry point: `server.js`
- Routes: `src/routes.js`
- Schema: `src/schema.js`

## Main Capabilities

- Create or find an active cart for a session or a signed-in customer.
- Add items after validating live product details through `product-service`.
- Update or remove cart items.
- Merge anonymous carts into customer carts after login.

## Notes

- Publishes `CART_UPDATED`.
- Current gaps are tracked in [../../../docs/KNOWN-GAPS.md](../../../docs/KNOWN-GAPS.md).
