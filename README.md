# Aisle Commerce SaaS

Proprietary software owned by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This repository is not free to use. No right to copy, modify, deploy, resell, sublicense, or redistribute this codebase is granted without explicit permission from Oluwayemi Oyinlola Michael.

## Overview

Aisle Commerce SaaS is a multi-tenant e-commerce platform organized as a Node.js monorepo. It contains:

- An Express SSR web experience for storefront, owner, and platform admin flows.
- A gateway that resolves tenant hosts, verifies authentication context, and proxies traffic to domain services.
- Bounded-context services for users, stores, compliance, customers, products, carts, orders, payments, and billing.
- A shared package for environment loading, database bootstrap, event delivery, JWT handling, internal request signing, and common constants.

## Repository Layout

- `apps/web` - SSR storefront and admin interface.
- `apps/gateway` - API gateway and reverse proxy.
- `apps/services/*` - Microservices grouped by domain.
- `packages/shared` - Shared runtime utilities used by every service.
- `docs` - Central documentation for architecture, environment, APIs, data model, and operational notes.

## Service Inventory

| Component | Default port | Status | Responsibility |
| --- | --- | --- | --- |
| `apps/web` | `3000` | Implemented | Server-rendered storefront, owner dashboard, and platform admin prototype |
| `apps/gateway` | `4000` | Implemented | Authentication-aware reverse proxy and tenant resolver |
| `user-service` | `4101` | Implemented | Platform registration, login, and staff directory |
| `store-service` | `4102` | Implemented | Store provisioning, lookup, and settings |
| `compliance-service` | `4103` | Implemented | KYC, KYB, documents, and reviews |
| `customer-service` | `4104` | Implemented | Customer registration, login, self-service, and store customer list |
| `product-service` | `4105` | Implemented | Product catalog CRUD and inventory reservations |
| `cart-service` | `4106` | Implemented | Anonymous and authenticated cart handling |
| `order-service` | `4107` | Implemented | Checkout, order creation, and order status updates |
| `payment-service` | `4108` | Implemented | Payment session creation, provider config, and webhook intake |
| `billing-service` | `4109` | Implemented | Subscription lifecycle and eligibility checks |
| `support-service` | `4110` | Planned package only | Reserved for support operations |
| `chat-service` | `4111` | Planned package only | Reserved for live chat and messaging |
| `notification-service` | `4112` | Planned package only | Reserved for outbound notifications |

## Running the Repository

1. Install dependencies with `npm install`.
2. Provide MySQL, Redis, and RabbitMQ if you want the full service mesh behavior.
3. Configure `.env` files as described in [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md).
4. Start the gateway with `npm start` or the web prototype with `npm run start:web`.
5. Start individual services with the root scripts such as `npm run start:user-service` and `npm run start:product-service`.

## Documentation Map

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)
- [docs/API-REFERENCE.md](docs/API-REFERENCE.md)
- [docs/DATA-MODEL.md](docs/DATA-MODEL.md)
- [docs/KNOWN-GAPS.md](docs/KNOWN-GAPS.md)
- [LICENSE.md](LICENSE.md)
- [NOTICE.md](NOTICE.md)

Package-level documentation also lives beside each workspace package in its local `README.md`.

## Ownership and Usage

- Owner: Oluwayemi Oyinlola Michael
- Portfolio: https://www.oyinlola.site/
- License metadata: `UNLICENSED`
- Commercial status: not free to use

If you need permission for any use beyond private review, obtain written approval from the owner first.
