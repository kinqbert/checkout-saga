/** A finished span, flattened by trace-relay and streamed to the web UI. */
export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  service: string;
  name: string;
  kind: "internal" | "server" | "client" | "producer" | "consumer";
  startMs: number;
  durationMs: number;
  error: boolean;
  attributes: Record<string, string | number | boolean>;
}

/** Span attribute keys the services set so the UI can draw the saga. */
export const TraceAttr = {
  orderId: "checkout.order_id",
  messageType: "messaging.message.type",
  messageId: "messaging.message.id",
  subject: "messaging.destination.name",
  sagaFrom: "checkout.saga.from",
  sagaTo: "checkout.saga.to",
} as const;
