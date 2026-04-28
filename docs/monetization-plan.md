# Roastie Monetization Plan

## Model

Roastie uses one-time Roast Pass credits instead of subscriptions:

- `Roast Pass`: $4.99 for 1 roast.
- `Party Pack`: $19.99 for 6 roasts.
- `Event Pack`: $99.00 for 40 roasts.

This fits the product better than a subscription because Roastie is an impulse/party purchase. The high-ARPU path is events and groups, not monthly retention.

## Square Integration

The app uses Square Checkout Payment Links, created server-side through `POST /v2/online-checkout/payment-links`.

Required env vars:

- `NEXT_PUBLIC_ROASTIE_PAYMENTS_ENABLED=true`
- `SQUARE_ENVIRONMENT=sandbox` or `production`
- `SQUARE_ACCESS_TOKEN=...`
- `SQUARE_LOCATION_ID=...`
- `SQUARE_WEBHOOK_SIGNATURE_KEY=...`
- `SQUARE_WEBHOOK_NOTIFICATION_URL=https://your-domain.com/api/monetization/webhook`

Optional env var:

- `ROASTIE_LEDGER_PATH=.data/monetization-ledger.json`

## Fulfillment

1. Browser receives a secure anonymous buyer cookie.
2. User chooses a pass pack.
3. Server creates a pending checkout in the local ledger.
4. Server creates a Square-hosted checkout page.
5. Square redirects back to Roastie after payment.
6. Roastie polls Square Payments API and/or receives a signed Square webhook.
7. Completed payments grant credits exactly once.
8. Starting a roast consumes one credit.

## Production Hardening

The file-backed ledger is enough for local demos and single-node hosting. Before real traffic, move the ledger to Postgres, Redis, or another durable database with row-level locking.
