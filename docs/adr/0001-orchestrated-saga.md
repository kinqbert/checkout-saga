# 1. Orchestration over choreography

**Status:** accepted

## Context

Checkout touches three services (order, inventory, payment), and each owns its own data. A distributed transaction (2PC) would couple their availability and isn't supported by NATS anyway. That leaves a saga: a sequence of local transactions, with compensations when a later step fails.

A saga can be **choreographed**, where each service reacts to the others' events, or **orchestrated**, where one component sends commands and reacts to the replies.

## Decision

Orchestrate. The order service owns the saga. It sends commands (`checkout.cmd.*`) and reacts to replies (`checkout.evt.*`). The state machine is a pure function `transition(saga, event) → { saga, messages }`. The I/O shell around it is thin.

Step order follows one rule: **do the easiest step to undo first, and the step you can't undo last**. Reserving stock is easy to release, so it comes first. Capturing a payment would need a refund, so it comes last, and it becomes the pivot. After a successful capture nothing can fail, so there is no refund compensation to design, with one exception added later: a capture that lands after the saga timed out is refunded (see the README, "Timeouts").

Notification is **not** part of the saga. Order confirmed/cancelled are facts that notify subscribes to. A failing e-mail provider must never roll back a paid order.

## Consequences

- One place shows the whole flow: five states and six transitions, unit-tested without a database or broker.
- Inventory and payment don't know about each other or about the saga. They just handle commands.
- The orchestrator is a single point of logic, though not of availability: its consumers are durable, so it catches up after downtime.
- Every event updates the order row under `SELECT … FOR UPDATE`, so concurrent events for one order are serialised.
