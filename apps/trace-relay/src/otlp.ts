import type { TraceSpan } from "@checkout/contracts";

// The subset of the OTLP/HTTP JSON encoding we read.
interface AnyValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
}
interface KeyValue {
  key: string;
  value?: AnyValue;
}
interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind?: number;
  startTimeUnixNano: string | number;
  endTimeUnixNano: string | number;
  attributes?: KeyValue[];
  status?: { code?: number };
}
export interface OtlpTraceRequest {
  resourceSpans?: {
    resource?: { attributes?: KeyValue[] };
    scopeSpans?: { spans?: OtlpSpan[] }[];
  }[];
}

const KINDS: TraceSpan["kind"][] = ["internal", "internal", "server", "client", "producer", "consumer"];

function value(v: AnyValue | undefined): string | number | boolean | undefined {
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return Number(v.intValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.boolValue !== undefined) return v.boolValue;
  return undefined;
}

function attributes(list: KeyValue[] = []): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const kv of list) {
    const v = value(kv.value);
    if (v !== undefined) out[kv.key] = v;
  }
  return out;
}

const nanosToMs = (n: string | number) => Number(BigInt(n) / 1000n) / 1000;

/** Flattens an OTLP export request into UI-friendly spans. */
export function flatten(req: OtlpTraceRequest): TraceSpan[] {
  const spans: TraceSpan[] = [];
  for (const rs of req.resourceSpans ?? []) {
    const service = String(attributes(rs.resource?.attributes)["service.name"] ?? "unknown");
    for (const ss of rs.scopeSpans ?? []) {
      for (const s of ss.spans ?? []) {
        const startMs = nanosToMs(s.startTimeUnixNano);
        spans.push({
          traceId: s.traceId,
          spanId: s.spanId,
          ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
          service,
          name: s.name,
          kind: KINDS[s.kind ?? 1] ?? "internal",
          startMs,
          durationMs: Math.max(0, nanosToMs(s.endTimeUnixNano) - startMs),
          error: s.status?.code === 2,
          attributes: attributes(s.attributes),
        });
      }
    }
  }
  return spans;
}
