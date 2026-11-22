# 3. JetStream stream layout

**Status:** accepted

## Decision

Two streams, created idempotently by every service at boot:

| Stream | Subjects | Retention | Why |
|---|---|---|---|
| `CHECKOUT` | `checkout.>` | limits, 7 days, 2 min duplicate window | Saga commands and events |
| `CATALOG` | `catalog.>` | limits, **1 message per subject** | Product snapshots, one subject per sku |

Subjects equal message types for the saga: `checkout.{cmd|evt}.{service}.{verb}`. Each consumer is a durable pull consumer with explicit acks and its own filter:

| Durable | Filter |
|---|---|
| `order-saga` | `checkout.evt.inventory.>`, `checkout.evt.payment.>` |
| `order-catalog` | `catalog.product.>` |
| `inventory` | `checkout.cmd.inventory.>` |
| `payment` | `checkout.cmd.payment.>` |
| `notify` | `checkout.evt.order.>` |

**Limits retention, not work-queue.** Work-queue retention deletes a message on the first ack and allows only one consumer per subject. That breaks as soon as a second service wants the same event (for example, notify plus a future analytics consumer). With limits retention, consumers are independent and a new one can replay history.

**`max_msgs_per_subject: 1`** turns `CATALOG` into a compacted log. A new consumer replays exactly one message per product, which is the current catalog.

## Consequences

- Retries: `nak()` with exponential backoff (0.5 s up to 15 s), at most 20 deliveries. A message that fails schema validation is `term()`-ed and never retried.
- The stream config lives in code (`libs/messaging/src/nats.ts`) and is reconciled on every boot.
