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
import { W3CTraceContextPropagator } from "@opentelemetry/core";
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
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(provider);
  return provider;
}

export const tracer = () => trace.getTracer("checkout-saga");

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
