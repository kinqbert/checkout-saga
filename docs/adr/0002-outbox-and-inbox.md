# 2. Transactional outbox and inbox

**Status:** accepted

## Context

"Save to Postgres, then publish to NATS" has two failure windows. A crash between the two loses the message, and the saga is stuck forever. Publishing first and then failing the commit announces something that never happened. The other side has the same problem: JetStream delivers at least once, so consumers will see duplicates.

## Decision

**Outbox.** Every service that emits messages has an `outbox` table in its own schema. The business change and the outbox rows are written in **one** transaction. `OutboxRelay` (in `libs/messaging`) then:

1. selects unpublished rows `ORDER BY seq … FOR UPDATE SKIP LOCKED`
2. publishes each with `msgID = row.id`
3. marks them `published_at = now()` in the same transaction

The writer calls `relay.nudge()` after commit, so latency is milliseconds rather than one poll interval (500 ms). A partial index on `seq WHERE published_at IS NULL` keeps the poll cheap.

**Inbox.** Every consumer inserts `(message_id, consumer)` into its `inbox` table in the same transaction as its side effects. A duplicate insert hits `ON CONFLICT DO NOTHING`, and the handler skips its work and acks.

Payment calls its (fake) provider *outside* the transaction, so a slow external call doesn't hold a connection. It passes the order id as the provider's idempotency key, which is how real payment APIs make retries safe, and it checks for an existing payment for the order first.

## Consequences

- No lost messages and no phantom messages. Duplicates are filtered twice: JetStream's duplicate window catches relay retries, and the inbox catches everything else.
- Messages from one service leave in commit order (`seq`).
- Two extra tables per service, plus a relay loop. Inbox rows need periodic pruning, which isn't done yet (see the README).
