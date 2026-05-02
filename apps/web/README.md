# Web App

Proprietary software by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This package is not free to use.

## Purpose

`@aisle/web` is the Express SSR experience for storefront visitors, store owners, and platform admins. It renders EJS templates for browsing products, managing stores, and viewing platform operations screens.

## Runtime

- Default port: `3000`
- Entry point: `app.js`
- Views: `views/`
- Public assets: `public/`
- App bootstrap: `src/create-app.js`

## Main Responsibilities

- Host-based storefront versus platform rendering.
- Owner dashboard, store admin, and platform admin screens.
- Service-backed storefront catalog, cart, checkout, account, and owner flows.
- Currency selection and display helpers.
- Presentation metadata overlays for store and product content.

## Notes

- The app renders the browser experience but depends on the gateway and backend services for most commerce flows.
- Environment details live in [../../docs/ENVIRONMENT.md](../../docs/ENVIRONMENT.md).
