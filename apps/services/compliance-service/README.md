# Compliance Service

Proprietary software by Oluwayemi Oyinlola Michael. Portfolio: https://www.oyinlola.site/

This package is not free to use.

## Purpose

`@aisle/compliance-service` manages KYC, KYB, uploaded compliance documents, and review decisions.

## Runtime

- Default port: `4103`
- Entry point: `server.js`
- Routes: `src/routes.js`
- Schema: `src/schema.js`

## Main Capabilities

- KYC submission for platform users.
- KYB submission for owners and stores.
- Compliance document metadata intake.
- Self-service compliance summary queries.
- Staff review workflow for KYC and KYB records.

## Notes

- Publishes `KYC_SUBMITTED`, `KYB_SUBMITTED`, and `COMPLIANCE_STATUS_CHANGED`.
- Review access is limited to platform owners and support agents.
