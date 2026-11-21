# 5. Live tracing through a custom relay

**Status:** accepted

## Context

The point of the demo is to *see* a distributed transaction. Jaeger or Tempo would store traces, but the UI wants a live push of spans as they finish, and Jaeger on a small VPS costs a lot of memory.

## Decision

- Services use the OpenTelemetry SDK with an OTLP/HTTP JSON exporter, batched every 100 ms.
- **trace-relay** is under 200 lines of plain Node. It accepts `POST /v1/traces`, flattens spans and fans them out over Server-Sent Events, keeping a 5 000-span ring buffer for late joiners. The gateway proxies the stream at `/api/stream`.
- The trace context crosses the async boundary through the outbox. `outbox.headers` stores the writer's `traceparent`, and the relay's `PRODUCER` span and the consumer's `CONSUMER` span continue it. One order is one trace.
- HTTP tracing is a small middleware rather than auto-instrumentation. Auto-instrumentation needs loader hooks under ESM and adds a lot of noise. The gateway starts traces only for writes, and internal services only continue traces they are handed (`continueOnly`), so UI polling creates no traces.

## Consequences

- The UI's graph and waterfall are drawn from real spans, not a simulation.
- The exporter speaks standard OTLP, so pointing `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` at a collector sends the same data to Tempo or Jaeger.
- trace-relay keeps no history across restarts. That's acceptable for a live view.
