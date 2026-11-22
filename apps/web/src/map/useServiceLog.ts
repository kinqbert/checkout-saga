import type { TraceSpan } from "@checkout/contracts";
import { useEffect, useRef, useState } from "react";
import { shortType, toneOf, type Tone } from "../format";
import { traceStore } from "../traceStore";
import { edgeFor, isService, messageType, type ServiceId } from "./model";

export interface Stats {
  handled: number;
  recent: number[];
}
export const STATS_WINDOW = 20;

export interface LogEntry {
  id: string;
  dir: "in" | "out";
  label: string;
  tone: Tone;
  at: number;
  ms?: number | undefined;
  mine: boolean;
  error: boolean;
}
const LOG_SIZE = 8;

// one unit of work: a message processed, or (gateway) an order request forwarded.
function workOf(s: TraceSpan): ServiceId | undefined {
  if (s.service === "gateway") return edgeFor(s) === "http" ? "gateway" : undefined;
  if (s.kind !== "consumer" || !messageType(s) || s.attributes["demo.lab.refused"]) return undefined;
  return isService(s.service) ? s.service : undefined;
}

// per-service counters and recent events, from every visitor's spans, backlog included.
export function useServiceLog(mine: Set<string>) {
  const [stats, setStats] = useState<Partial<Record<ServiceId, Stats>>>({});
  const [logs, setLogs] = useState<Partial<Record<ServiceId, LogEntry[]>>>({});
  const mineRef = useRef(mine);
  mineRef.current = mine;

  useEffect(() => {
    const ingest = (spans: TraceSpan[]) => {
      const durations: Partial<Record<ServiceId, number[]>> = {};
      const entries: Partial<Record<ServiceId, LogEntry[]>> = {};
      for (const s of [...spans].sort((a, b) => a.startMs - b.startMs)) {
        const worker = workOf(s);
        const type = messageType(s);
        const sender = s.kind === "producer" && type && isService(s.service) ? s.service : undefined;
        const svc = worker ?? sender;
        if (!svc) continue;
        if (worker) (durations[worker] ??= []).push(s.durationMs);
        (entries[svc] ??= []).push({
          id: s.spanId,
          dir: worker ? "in" : "out",
          label: type ? shortType(type) : "POST /orders",
          tone: type ? toneOf(type) : "info",
          at: s.startMs,
          ms: worker ? s.durationMs : undefined,
          mine: mineRef.current.has(s.traceId),
          error: s.error,
        });
      }
      if (Object.keys(entries).length === 0) return;
      setLogs((prev) => {
        const next = { ...prev };
        for (const [svc, list] of Object.entries(entries) as [ServiceId, LogEntry[]][])
          next[svc] = [...list.reverse(), ...(prev[svc] ?? [])].slice(0, LOG_SIZE);
        return next;
      });
      setStats((prev) => {
        const next = { ...prev };
        for (const [svc, ds] of Object.entries(durations) as [ServiceId, number[]][]) {
          const cur = prev[svc] ?? { handled: 0, recent: [] };
          next[svc] = { handled: cur.handled + ds.length, recent: [...cur.recent, ...ds].slice(-STATS_WINDOW) };
        }
        return next;
      });
    };
    ingest(traceStore.all());
    return traceStore.subscribe(ingest);
  }, []);

  return { stats, logs };
}
