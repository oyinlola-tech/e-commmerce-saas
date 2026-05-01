# Notification Service

Proprietary software by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This package is not free to use.

## Current Status

`@aisle/notification-service` is now a runnable SMTP-backed notification microservice.

## Intended Role

- Transactional email delivery
- Outbound customer and owner notifications
- Event-driven notification fanout from other services
- Mail queue and provider integration

## Notes

- Reserved default port: `4112`
- The service exposes `POST /emails/send` for signed internal requests from sibling services.
- SMTP credentials can be configured with either the generic `SMTP_*` variables or service-specific `NOTIFICATION_SERVICE_SMTP_*` overrides.
