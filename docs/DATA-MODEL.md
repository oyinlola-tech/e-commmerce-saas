# Data Model

Proprietary software by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This system is not free to use.

## User Service

- `platform_users` - Platform staff and store owners with `name`, `email`, `password_hash`, `role`, `status`, and timestamps. Unique on `email`.

## Store Service

- `stores` - Tenant records with `owner_id`, `name`, `subdomain`, `custom_domain`, `logo_url`, `theme_color`, `store_type`, `template_key`, `font_preset`, support contacts, activation flag, and SSL status. Unique on `subdomain` and `custom_domain`.

## Compliance Service

- `kyc_profiles` - Owner-level KYC profile with personal identity fields, country, status, and metadata. One row per owner.
- `kyb_profiles` - Owner-level KYB profile with optional `store_id`, business identity, country, status, and metadata. One row per owner.
- `compliance_documents` - Uploaded document metadata keyed by owner, profile type, and profile id.
- `compliance_reviews` - Staff review history with reviewer identity, target record, review status, and optional note.

## Customer Service

- `customers` - Store-scoped customer identities with profile details, `password_hash`, addresses JSON, and metadata JSON. Unique on `store_id + email`.

## Product Service

- `products` - Store-scoped catalog entries with slug, description, price, compare-at price, SKU, inventory counts, image JSON, publish status, and soft-delete marker. Unique on `store_id + slug` and `store_id + sku`.
- `inventory_reservations` - Reservation header rows for pending checkout inventory locks.
- `inventory_reservation_items` - Reserved quantities per product inside a reservation.

## Cart Service

- `carts` - Active or abandoned carts keyed by store and either customer id or anonymous session id.
- `cart_items` - Product snapshots captured in the cart at add time, with quantity and item price. Unique on `cart_id + product_id`.

## Order Service

- `orders` - Store-scoped orders with customer, order status, payment status, reservation link, payment reference, subtotal, total, currency, shipping address JSON, and customer snapshot JSON.
- `order_items` - Line items copied from the cart into the order with product id, name, unit price, and quantity.

## Payment Service

- `payments` - Payment attempts with order, store, customer, amount, provider, reference, provider session id, status, and metadata JSON. Unique on `reference`.
- `payment_provider_configs` - Store-scoped provider credentials with encrypted secret material and activation state. Unique on `store_id + provider`.
- `payment_webhooks` - Inbound webhook log table with provider, reference, payload JSON, and status.

## Billing Service

- `subscriptions` - Owner-scoped subscription state with plan, status, trial end, and current period end. One row per owner.
- `invoices` - Invoice records tied to owner and subscription with amount, currency, provider reference, status, and metadata JSON.

## Schema Notes

- The current schemas use indexes and unique keys but do not define explicit SQL foreign keys.
- JSON columns are used for semi-structured payloads such as addresses, customer metadata, shipping addresses, customer snapshots, provider webhook payloads, and document metadata.
