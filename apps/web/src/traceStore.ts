import type { TraceSpan } from "@checkout/contracts";
import { useSyncExternalStore } from "react";

type Listener = (spans: TraceSpan[], live: boolean) => void;
export type StreamStatus = "connecting" | "live" | "offline";

const MAX_TRACES = 300;

/**
 * Holds spans streamed from trace-relay, grouped by trace. `live` is false for
 * the backlog sent on (re)connect, so the graph only animates new traffic.
 */
class TraceStore {
  private traces = new Map<string, TraceSpan[]>();
  private seen = new Set<string>();
  private listeners = new Set<Listener>();
  private statusListeners = new Set<() => void>();
  version = 0;
  status: StreamStatus = "connecting";

  connect(): void {
    const es = new EventSource("/api/stream");
    let backlog = true;
    es.onopen = () => {
      backlog = true;
      this.setStatus("live");
    };
    es.onerror = () => this.setStatus(es.readyState === EventSource.CLOSED ? "offline" : "connecting");
    es.addEventListener("spans", (e) => {
      const spans = JSON.parse((e as MessageEvent<string>).data) as TraceSpan[];
      this.add(spans, !backlog);
      backlog = false;
    });
  }

  add(spans: TraceSpan[], live: boolean): void {
    const fresh = spans.filter((s) => !this.seen.has(s.spanId));
    if (fresh.length === 0) return;
    for (const s of fresh) {
      this.seen.add(s.spanId);
      const list = this.traces.get(s.traceId);
      if (list) list.push(s);
      else this.traces.set(s.traceId, [s]);
    }
    while (this.traces.size > MAX_TRACES) {
      const oldest = this.traces.keys().next().value!;
      for (const s of this.traces.get(oldest) ?? []) this.seen.delete(s.spanId);
      this.traces.delete(oldest);
    }
    this.version++;
    for (const l of this.listeners) l(fresh, live);
  }

  /** Every span held right now (the latest traces), for counters starting late. */
  all(): TraceSpan[] {
    return [...this.traces.values()].flat();
  }

  trace(traceId: string): TraceSpan[] {
    return this.traces.get(traceId) ?? [];
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };

  private setStatus(s: StreamStatus) {
    this.status = s;
    for (const l of this.statusListeners) l();
  }

  subscribeStatus = (l: () => void) => {
    this.statusListeners.add(l);
    return () => void this.statusListeners.delete(l);
  };
}

export const traceStore = new TraceStore();

export const useTraceVersion = () =>
  useSyncExternalStore(
    (cb) => traceStore.subscribe(() => cb()),
    () => traceStore.version,
  );

export const useStreamStatus = () =>
  useSyncExternalStore(traceStore.subscribeStatus, () => traceStore.status);
