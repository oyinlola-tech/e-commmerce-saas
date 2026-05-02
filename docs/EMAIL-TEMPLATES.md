# Email Templates

This document defines the transactional email matrix for Aisle Commerce so customer emails stay store-branded and owner emails stay platform-branded.

## Branding rules

- Customer-facing emails use the exact store identity from `store-service`: `name`, `logo_url`, `theme_color`, `support_email`, and storefront URL.
- Store-owner emails use the platform identity as the visual shell and can optionally mention the owner's store name in the copy, but only when the triggering event provides an explicit `store_id`.
- The notification renderer should stay centralized in `apps/services/notification-service` so HTML is not duplicated across services.

## Delivery rules

- Transactional emails should resolve the recipient from the exact account, customer, order, payment, subscription, or compliance record tied to the event.
- Owner emails must not infer a store by picking the first store owned by that user; if the event does not identify a store, the email should remain owner-scoped and omit store-specific branding or copy.
- Customer emails should only be store-branded when a valid `store_id` is present or when the sender deliberately supplies explicit store-brand data for preview purposes.
- Render-ready templates should not be treated as live automation until a real trigger with exact recipient data exists.

## Implemented now

| Template key | Audience | Brand source | Trigger |
| --- | --- | --- | --- |
| `platform.password_reset_otp` | Platform user / store owner | Platform brand | `user-service` password reset request |
| `platform.owner_welcome` | Store owner | Platform brand | `USER_REGISTERED` |
| `platform.owner_email_verification_otp` | Store owner | Platform brand | Ready for future verification flow |
| `platform.owner_login_alert` | Store owner | Platform brand | Ready for future suspicious-login flow |
| `platform.store_created` | Store owner | Platform brand | `STORE_CREATED` |
| `platform.subscription_trial_started` | Store owner | Platform brand | `PAYMENT_SUCCEEDED` on subscription trial authorization |
| `platform.subscription_trial_ending` | Store owner | Platform brand | Render-ready for reminder scheduler |
| `platform.subscription_trial_ended` | Store owner | Platform brand | Render-ready for expiry workflow |
| `platform.subscription_invoice_created` | Store owner | Platform brand | Render-ready for invoice creation workflow |
| `platform.subscription_invoice_paid` | Store owner | Platform brand | `PAYMENT_SUCCEEDED` for invoice entities |
| `platform.subscription_payment_failed` | Store owner | Platform brand | `PAYMENT_FAILED` for invoice or subscription entities |
| `platform.subscription_renewed` | Store owner | Platform brand | Render-ready for renewal-specific flow |
| `platform.subscription_cancellation_scheduled` | Store owner | Platform brand | `SUBSCRIPTION_CHANGED` when `cancel_at_period_end` is true |
| `platform.subscription_cancelled` | Store owner | Platform brand | `SUBSCRIPTION_CHANGED` when status becomes `cancelled` |
| `platform.compliance_status_changed` | Store owner | Platform brand | `COMPLIANCE_STATUS_CHANGED` |
| `store.customer_password_reset_otp` | Customer | Store brand from `store-service` | `customer-service` password reset request |
| `store.customer_welcome` | Customer | Store brand from `store-service` | `CUSTOMER_REGISTERED` |
| `store.customer_email_verification_otp` | Customer | Store brand from `store-service` | Ready for future verification flow |
| `store.customer_login_alert` | Customer | Store brand from `store-service` | Ready for future suspicious-login flow |
| `store.order_confirmation` | Customer | Store brand from `store-service` | `ORDER_CREATED` |
| `store.payment_receipt` | Customer | Store brand from `store-service` | `PAYMENT_SUCCEEDED` for order entities |
| `store.payment_failed` | Customer | Store brand from `store-service` | `PAYMENT_FAILED` for order entities |
| `store.invoice_issued` | Customer | Store brand from `store-service` | Render-ready for invoice workflow |
| `store.order_status_processing` | Customer | Store brand from `store-service` | `ORDER_STATUS_CHANGED` |
| `store.order_status_shipped` | Customer | Store brand from `store-service` | `ORDER_STATUS_CHANGED` when status reaches shipping |
| `store.order_status_delivered` | Customer | Store brand from `store-service` | `ORDER_STATUS_CHANGED` when status reaches delivery |
| `store.order_cancelled` | Customer | Store brand from `store-service` | `ORDER_STATUS_CHANGED` when status becomes cancelled |
| `store.refund_issued` | Customer | Store brand from `store-service` | Render-ready for refund workflow |
| `store.abandoned_cart_reminder` | Customer | Store brand from `store-service` | Render-ready for cart recovery workflow |
| `store.wishlist_back_in_stock` | Customer | Store brand from `store-service` | Render-ready for inventory alert workflow |
| `store.wishlist_price_drop` | Customer | Store brand from `store-service` | Render-ready for merchandising alert workflow |
| `store.review_request` | Customer | Store brand from `store-service` | Render-ready for post-delivery follow-up |

## Live automation now

- `notification-service` now consumes registration, store creation, order, payment, subscription-state, and compliance events for the templates that already have real data sources.
- Owner billing and compliance emails now avoid "primary store" guessing; store-specific copy is included only when the event payload carries a real `store_id`.
- Previewing is supported with `POST /emails/render` in `notification-service` so templates can be inspected without sending a real email.
- Sending still works through `POST /emails/send`, and template sends now accept `template_key`, `template_data`, `brand`, and `store_id`.

## Recommended owner and platform emails

| Template key | Why it matters | Likely trigger in this repo |
| --- | --- | --- |
| `platform.owner_welcome` | Confirms account creation and sets first expectations. | `USER_REGISTERED` |
| `platform.owner_email_verification_otp` | Confirms the owner controls the email address. | Future verification flow |
| `platform.owner_login_alert` | Warns about unrecognized or suspicious logins. | Future auth security event |
| `platform.store_created` | Confirms a store was provisioned successfully. | `STORE_CREATED` |
| `platform.subscription_trial_started` | Tells the owner the free trial is active. | Billing verification success |
| `platform.subscription_trial_ending` | Prevents surprise billing and reduces failed renewals. | Scheduled check on `trial_ends_at` |
| `platform.subscription_trial_ended` | Explains what changed after the trial ended. | Trial expiry workflow |
| `platform.subscription_invoice_created` | Sends or announces a new subscription invoice. | Invoice creation |
| `platform.subscription_invoice_paid` | Acts as the billing receipt for owners. | `PAYMENT_SUCCEEDED` for invoices |
| `platform.subscription_payment_failed` | Prompts the owner to fix billing before access is affected. | `PAYMENT_FAILED` for invoices |
| `platform.subscription_renewed` | Confirms successful renewal and next billing date. | `SUBSCRIPTION_CHANGED` |
| `platform.subscription_cancellation_scheduled` | Confirms cancellation at period end. | `POST /subscriptions/cancel` |
| `platform.subscription_cancelled` | Final confirmation that billing has stopped. | `POST /subscriptions/cancel` |
| `platform.compliance_status_changed` | Communicates KYC/KYB approvals, rejections, or missing info. | `COMPLIANCE_STATUS_CHANGED` |

## Recommended customer emails

| Template key | Why it matters | Likely trigger in this repo |
| --- | --- | --- |
| `store.customer_welcome` | Confirms registration and introduces the account area. | `CUSTOMER_REGISTERED` |
| `store.customer_email_verification_otp` | Validates the email address before trust-sensitive actions. | Future verification flow |
| `store.customer_login_alert` | Warns about unrecognized customer logins. | Future auth security event |
| `store.order_confirmation` | Acknowledges the order immediately. | `ORDER_CREATED` |
| `store.payment_receipt` | Confirms successful payment with amount and reference. | `PAYMENT_SUCCEEDED` for orders |
| `store.payment_failed` | Lets the customer retry before abandoning checkout. | `PAYMENT_FAILED` for orders |
| `store.invoice_issued` | Supports invoice-based or B2B-style purchases. | Future invoice workflow |
| `store.order_status_processing` | Reassures the customer that fulfillment has started. | `ORDER_STATUS_CHANGED` |
| `store.order_status_shipped` | Announces shipment and tracking details. | Future shipped status workflow |
| `store.order_status_delivered` | Confirms delivery. | Future delivered status workflow |
| `store.order_cancelled` | Explains a cancellation clearly and quickly. | Future cancelled status workflow |
| `store.refund_issued` | Confirms refund amount and timing. | Future refund workflow |
| `store.abandoned_cart_reminder` | Recovers revenue from unfinished checkout sessions. | Future cart recovery workflow |
| `store.wishlist_back_in_stock` | Re-engages customers when saved items return. | Future inventory alert workflow |
| `store.wishlist_price_drop` | Re-engages customers when a saved item becomes cheaper. | Future merchandising alert workflow |
| `store.review_request` | Generates post-purchase feedback and trust signals. | Post-delivery workflow |

## Suggested rollout order

1. Auth and account emails: welcome, verification OTP, password reset OTP, login alert.
2. Checkout and payment emails: order confirmation, payment receipt, payment failed, invoice issued.
3. Fulfillment emails: processing, shipped, delivered, cancelled, refund issued.
4. Subscription emails: trial start, trial ending, invoice created, paid, failed, renewed, cancelled.
5. Retention emails: abandoned cart, wishlist alerts, review request.

## Data each template should expect

- Identity: recipient name, email, audience, locale if later added.
- Brand: store name, store logo, store theme color, platform name, support email.
- Commerce: order ID, invoice ID, currency, amount, line items, payment reference.
- Lifecycle: plan name, trial end date, renewal date, cancellation date, compliance status.
- Security: IP address, device, browser, rough location, timestamp.

## Code pointers

- Renderer and template catalog live in `apps/services/notification-service/src`.
- Store branding comes from `store-service`, which already exposes `name`, `logo_url`, `theme_color`, and `support_email`.
- Existing order and billing events already provide the main hooks we need for the next template wave.
