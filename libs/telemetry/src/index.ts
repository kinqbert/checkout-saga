import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import type { IncomingMessage, ServerResponse } from "node:http";

let provider: TracerProvider | undefined;

/**
 * Wires OpenTelemetry for one service: W3C trace context, async-local context
 * propagation and an OTLP/HTTP exporter (pointed at trace-relay by default).
 * Call it first thing in main.ts.
 */
export function startTelemetry(serviceName: string): { shutdown(): Promise<void> } {
  if (provider) return provider;

  const url =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? "http://localhost:4318/v1/traces";

  provider = new TracerProvider({
    resource: resourceFromAttributes({ "service.name": serviceName }),
    spanProcessors: [
      new BatchSpanProcessor({
        exporter: new OTLPTraceExporter({ url }),
        // Short delay: the UI draws the saga live, 5s batching would feel broken.
        scheduledDelayMillis: 100,
      }),
    ],
  });

  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  // Trace context plus W3C baggage: baggage carries demo settings (slow mode)
  // across every hop, including the outbox and NATS headers.
  propagation.setGlobalPropagator(
    new CompositePropagator({ propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()] }),
  );
  trace.setGlobalTracerProvider(provider);
  return provider;
}

export const tracer = () => trace.getTracer("checkout-saga");

/** Sends every finished span now; call before the process exits on purpose. */
export async function flushTelemetry(): Promise<void> {
  await provider?.forceFlush().catch(() => undefined);
}

/** Runs `fn` inside a new active span, recording errors and always ending it. */
export async function withSpan<T>(
  name: string,
  options: { kind?: SpanKind; attributes?: Attributes; parent?: Context },
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const parent = options.parent ?? context.active();
  return tracer().startActiveSpan(
    name,
    { kind: options.kind ?? SpanKind.INTERNAL, attributes: options.attributes },
    parent,
    async (span) => {
      try {
        return await fn(span);
      } catch (err) {
        markError(span, err);
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

export function markError(span: Span, err: unknown): void {
  span.recordException(err instanceof Error ? err : String(err));
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: err instanceof Error ? err.message : String(err),
  });
}

/** Serialises the active trace context (traceparent) into a plain header map. */
export function currentTraceHeaders(ctx: Context = context.active()): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(ctx, carrier);
  return carrier;
}

/** Restores a context from a header map produced by {@link currentTraceHeaders}. */
export function contextFromHeaders(headers: Record<string, string | undefined>): Context {
  return propagation.extract(context.active(), headers);
}

/** Reads a W3C baggage entry from the active context. */
export function baggageValue(key: string, ctx: Context = context.active()): string | undefined {
  return propagation.getBaggage(ctx)?.getEntry(key)?.value;
}

/** Runs `fn` with extra baggage entries, which every later hop inherits. */
export function withBaggage<T>(entries: Record<string, string>, fn: () => T): T {
  const current = propagation.getBaggage(context.active()) ?? propagation.createBaggage();
  let next = current;
  for (const [k, v] of Object.entries(entries)) next = next.setEntry(k, { value: v });
  return context.with(propagation.setBaggage(context.active(), next), fn);
}

/** Demo "slow mode": how long each service holds a message before handling it. */
export const PACE_KEY = "demo.pace";
/** Failure lab: the visitor's lab id, so faults apply to their orders only. */
export const LAB_KEY = "demo.lab";
export const SLOW_PACE_MS = 1000;

/**
 * In slow mode (baggage demo.pace=slow), waits SLOW_PACE_MS inside its own
 * span, so the pause is visible in the trace. A no-op in real time.
 */
export async function slowModeHold(): Promise<void> {
  if (baggageValue(PACE_KEY) !== "slow") return;
  await withSpan("demo: slow-mode hold", { attributes: { "demo.hold_ms": SLOW_PACE_MS } }, () =>
    new Promise<void>((r) => setTimeout(r, SLOW_PACE_MS)),
  );
}

export const currentTraceId = (): string | undefined =>
  trace.getActiveSpan()?.spanContext().traceId;

/**
 * Express/Nest middleware that opens a SERVER span per request, continuing a
 * trace when the caller sent a `traceparent` header.
 *
 * `continueOnly`: only trace requests that arrive with a trace context. Internal
 * services use it so the UI's polling reads do not each start a new trace.
 */
export function httpTracing(
  opts: { ignore?: (path: string, method: string) => boolean; continueOnly?: boolean } = {},
) {
  return (
    req: IncomingMessage & { path?: string },
    res: ServerResponse,
    next: (err?: unknown) => void,
  ): void => {
    const path = req.path ?? (req.url ?? "/").split("?")[0] ?? "/";
    if (opts.ignore?.(path, req.method ?? "GET")) return next();
    if (opts.continueOnly && !req.headers.traceparent) return next();

    const parent = propagation.extract(context.active(), req.headers);
    const span = tracer().startSpan(
      `${req.method} ${path}`,
      {
        kind: SpanKind.SERVER,
        attributes: { "http.request.method": req.method ?? "GET", "url.path": path },
      },
      parent,
    );
    res.on("finish", () => {
      span.setAttribute("http.response.status_code", res.statusCode);
      if (res.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    });
    context.with(trace.setSpan(parent, span), () => next());
  };
}

export { SpanKind, context, trace, type Span, type Context };
