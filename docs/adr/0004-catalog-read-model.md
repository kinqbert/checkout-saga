# 4. Catalog read model in the order service

**Status:** accepted

## Context

The order total must be calculated on the server; a client-sent price can't be trusted. Prices belong to the catalog, which inventory owns along with stock. The order service may not read inventory's tables.

Options considered:

1. **Synchronous call to inventory at checkout.** Simple, but if inventory is down or slow, nobody can check out. That is the coupling the saga exists to avoid.
2. **Inventory returns prices in `inventory.reserved`.** It works, but the order has no amount until the reservation, and the saga changes shape.
3. **Replicate the catalog into the order service via events.** Inventory stays the source of truth.

## Decision

Option 3. Inventory publishes `catalog.evt.product.upserted` (sku, name, price) through its outbox whenever a product is created or repriced. The order service keeps `orders.products` up to date from those events and prices orders against it, inside the same transaction that creates the order.

The upsert only overwrites a row if the event is newer (`source_updated_at <= occurredAt`), so redelivered or reordered events are harmless without an inbox. Each order stores a snapshot of `{ sku, name, quantity, unitPrice }`, so later price changes never rewrite history.

## Consequences

- Checkout works while inventory is down. Stock reservation simply waits in the stream.
- The copy can be a few milliseconds out of date (eventual consistency). For prices, the accepted trade-off is that an order placed during that window gets the previous price.
- Unknown skus are rejected with 422 before any saga starts.
