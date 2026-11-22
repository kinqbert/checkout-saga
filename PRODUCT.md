# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences visit the live demo, and the page must serve both equally:

- **Recruiters and hiring managers**, linked from kinqbert.dev or a CV, often spending under a minute. They need to see something real happen after one click and understand roughly what it proves without reading docs.
- **Hiring engineers** checking whether the author really understands distributed transactions. They open an order, read its saga states and inspect the trace span by span.

## Product Purpose

Checkout Saga is a portfolio piece by Maksym Perekhodko (full-stack engineer, kinqbert.dev). It runs a real event-driven checkout across five services and draws every message as it happens. Success means a visitor places an order, watches it travel through the services, sees what happens when something fails (declined card → stock released), and leaves convinced the author can build distributed systems that hold up.

## Positioning

The animation isn't simulated. Every pulse on the graph is drawn from a real OpenTelemetry span emitted by a real service (NestJS, Postgres, NATS JetStream), with a transactional outbox, inbox deduplication and one trace per order. A neighbouring portfolio demo with a scripted animation can't honestly claim that.

## Operating Context

- Reached from kinqbert.dev, the author's GitHub (github.com/kinqbert/checkout-saga) or a CV link, on desktop and on phones.
- A shared public deployment on one small VPS. Other visitors may be placing orders at the same time; the visitor's **own orders take priority** in what the page shows, and other people's traffic is secondary or hidden.
- The demo catalogue is fake: six products, a fake card with a $500 limit, and low stock on purpose for the sneakers.

## Capabilities and Constraints

- One-click scenarios: happy path, card declined (compensation), out of stock. A custom cart with server-side pricing. Restocking.
- A live service graph (gateway, order orchestrator, inventory, payment, notify) animated from spans streamed over SSE.
- Per order: state transitions with timings, cancel reason, and a span waterfall.
- A notifications feed (simulated e-mails from the notify service).
- An explanation of the four ideas: orchestrated saga, transactional outbox, inbox/idempotency, one trace per order.
- Stack: React 19 + React Flow 13 + Vite, served by the NestJS gateway. The public API is rate limited.
- **Binding layout decision (user):** the service graph fills the whole viewport, and every other panel floats on top of it (kept through the visual redesign).

## Brand Commitments

- Credit the author as "Maksym Perekhodko", linking to kinqbert.dev and github.com/kinqbert/checkout-saga. The demo does **not** borrow kinqbert.dev's visual identity: the user tried it (cream, serif, coral, halftone) and rejected it as not fitting the demo.
- Standing preference (user, 2026-11-21): **clean**. Neutral, precise product UI at the craft level of Linear and Vercel: one sans, hairline borders, very little colour, exact spacing. Light and dark follow the visitor's system setting.
- Voice: short, confident and plain.

## Evidence on Hand

- The running system itself, its README and its ADRs (docs/adr). The end-to-end check (scripts/e2e.mjs) proves the guarantees.
- No testimonials, metrics or users exist, and none may be invented.

## Product Principles

1. **Real, not staged.** Everything on screen comes from the running system; never fake an animation or a number.
2. **One click to the point.** The first viewport invites one action and shows its consequence across the system.
3. **Failure is the feature.** Compensation and rejection paths are as visible and as legible as the happy path.
4. **Depth on demand.** Recruiters get the story at a glance; engineers can open states, spans and timings without leaving the page.
5. **Your order first.** The visitor's own activity is the focus; shared traffic never drowns it.

## Accessibility & Inclusion

No product-specific standard was set. Aim for WCAG 2.2 AA contrast on the dark theme, keyboard access to every control, and `prefers-reduced-motion` support for the pulses.
