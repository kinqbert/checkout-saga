import { useEffect, useRef, useState } from "react";
import { shortType, toneOf, type Tone } from "../format";
import { traceStore } from "../traceStore";
import { destination, edgeFor, messageType, type EdgeId, type ServiceId } from "./model";
import type { Pulse } from "./PulseEdge";
import { DOING, DONE, DONE_MS, NOTIFY_DONE, notableSpan, type Stamped, type Status } from "./status";

// in slow mode a service holds each message ~1 s; the dot lands halfway through.
const TRAVEL_MS = { slow: 450, mine: 900, others: 1100, ownRequest: 600 };
const MAX_PULSES = 9;

// your request's span only arrives once it's done, so the page draws that first hop itself.
type OwnRequestListener = () => () => void;
const ownRequestListeners = new Set<OwnRequestListener>();
// call when your order request leaves; call the returned function when it answers.
export function announceOwnRequest(): () => void {
  const done = [...ownRequestListeners].map((l) => l());
  return () => done.forEach((d) => d());
}

type Waiting = { count: number; retry: number };

// busy/waiting are recounted from the in-flight set, never kept as +1/-1 counters, so a
// missed span can't leave a spinner on. Keyed by message id: a re-sent message lands once.
function useInFlight(onLanded: (dest: ServiceId, type: string) => void) {
  type Entry = { dest: ServiceId; landed: boolean; waiting: boolean; retry: number };
  const inFlight = useRef(new Map<string, Entry>());
  // a "processed" span can arrive before its "published" one; don't track those late publishes.
  const finished = useRef(new Set<string>());
  const [busy, setBusy] = useState<Partial<Record<ServiceId, boolean>>>({});
  const [waiting, setWaiting] = useState<Partial<Record<ServiceId, Waiting>>>({});

  const recount = () => {
    const b: Partial<Record<ServiceId, boolean>> = {};
    const w: Partial<Record<ServiceId, Waiting>> = {};
    for (const e of inFlight.current.values()) {
      if (!e.landed) continue;
      if (!e.waiting) b[e.dest] = true;
      else {
        const cur = (w[e.dest] ??= { count: 0, retry: 0 });
        cur.count++;
        cur.retry = Math.max(cur.retry, e.retry);
      }
    }
    setBusy(b);
    setWaiting(w);
  };

  const finish = (key: string) => {
    finished.current.add(key);
    if (finished.current.size > 500) finished.current.clear();
    if (inFlight.current.delete(key)) recount();
  };

  const send = (key: string, dest: ServiceId, travelMs: number, type: string) => {
    if (finished.current.has(key)) return;
    const entry: Entry = { dest, landed: false, waiting: false, retry: 0 };
    inFlight.current.set(key, entry);
    setTimeout(() => {
      if (inFlight.current.get(key) !== entry) return; // processed before its dot arrived
      entry.landed = true;
      recount();
      onLanded(dest, type);
      // safety net if the "processed" span never arrives; a slow step takes ~25 s, a refused one 60 s.
      const giveUpAt = Date.now() + 30_000;
      const check = () =>
        setTimeout(() => {
          if (inFlight.current.get(key) !== entry) return;
          if (Date.now() < (entry.waiting ? giveUpAt + 40_000 : giveUpAt)) return check();
          finish(key);
        }, 2000);
      check();
    }, travelMs);
  };

  const refuse = (key: string, retry: number) => {
    const entry = inFlight.current.get(key);
    if (!entry) return;
    entry.waiting = true;
    entry.retry = Math.max(entry.retry, retry);
    recount();
  };

  return { busy, waiting, send, finish, refuse };
}

// everything that moves on the map, driven by spans as they arrive.
export function useLiveActivity(mine: Set<string>, slow: boolean) {
  const [pulses, setPulses] = useState<Partial<Record<EdgeId, Pulse[]>>>({});
  const [flash, setFlash] = useState<Partial<Record<ServiceId, { n: number; tone: Tone }>>>({});
  const [done, setDone] = useState<Partial<Record<ServiceId, Stamped<Status>>>>({});
  const [doing, setDoing] = useState<Partial<Record<ServiceId, Stamped<{ text: string }>>>>({});
  const [confetti, setConfetti] = useState(0);
  const { busy, waiting, send, finish, refuse } = useInFlight((dest, type) => {
    const text = DOING[type];
    if (text) setDoing((d) => ({ ...d, [dest]: { text, at: Date.now() } }));
  });

  const mineRef = useRef(mine);
  mineRef.current = mine;
  const slowRef = useRef(slow);
  slowRef.current = slow;

  const addPulses = (next: Partial<Record<EdgeId, Pulse[]>>) =>
    setPulses((p) => {
      const out = { ...p };
      for (const [edge, list] of Object.entries(next) as [EdgeId, Pulse[]][])
        out[edge] = [...(p[edge] ?? []), ...list].slice(-MAX_PULSES);
      return out;
    });
  const addFlashes = (next: Partial<Record<ServiceId, Tone>>) =>
    setFlash((f) => {
      const out = { ...f };
      for (const [svc, tone] of Object.entries(next) as [ServiceId, Tone][]) out[svc] = { n: (f[svc]?.n ?? 0) + 1, tone };
      return out;
    });

  useEffect(() => {
    const onOwnRequest = () => {
      const ms = slowRef.current ? TRAVEL_MS.slow : TRAVEL_MS.ownRequest;
      const pulse: Pulse = { id: `local-${Date.now()}`, ms, tone: "info", label: "POST /orders", mine: true };
      send(pulse.id, "order", ms, "http");
      addPulses({ http: [pulse] });
      addFlashes({ gateway: "info" });
      return () => finish(pulse.id);
    };
    ownRequestListeners.add(onOwnRequest);
    return () => void ownRequestListeners.delete(onOwnRequest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // only live spans animate; the backlog sent on connect is history.
  useEffect(
    () =>
      traceStore.subscribe((spans, live) => {
        if (!live) return;
        const newPulses: Partial<Record<EdgeId, Pulse[]>> = {};
        const newFlashes: Partial<Record<ServiceId, Tone>> = {};
        const newDone: Partial<Record<ServiceId, Stamped<Status>>> = {};
        const pinned = new Set<string>();
        const tell = (svc: string, status: Status, flash: Tone = status.tone) => {
          newFlashes[svc as ServiceId] = flash;
          newDone[svc as ServiceId] = { ...status, at: Date.now() };
        };

        for (const s of [...spans].sort((a, b) => a.startMs - b.startMs)) {
          const isMine = mineRef.current.has(s.traceId);
          const type = messageType(s);
          const tone = type ? toneOf(type) : "info";
          const key = String(s.attributes["messaging.message.id"] ?? "") || s.parentSpanId;

          if (isMine && s.service === "gateway") continue;
          // finish tracking even if the order has since dropped out of "yours".
          if (s.kind === "consumer" && key) {
            if (s.attributes["demo.lab.refused"]) refuse(key, Number(s.attributes["messaging.message.delivery_count"] ?? 1));
            else finish(key);
          }
          const notable = notableSpan(s);
          if (notable) {
            if (isMine) {
              tell(s.service, notable);
              if (notable.pin) pinned.add(s.service);
            }
            continue; // nothing travels: no dot, no tracking
          }
          if (!isMine) {
            const edge = edgeFor(s);
            if (edge) (newPulses[edge] ??= []).push({ id: s.spanId, ms: TRAVEL_MS.others, tone, label: shortType(type), mine: false });
            continue;
          }

          if (s.attributes["demo.lab.refused"]) continue;
          if (s.kind === "consumer" || s.kind === "server") {
            newFlashes[s.service as ServiceId] = tone;
            const told = s.service === "notify" ? NOTIFY_DONE[type] : undefined;
            if (told) tell(s.service, told, tone);
          }
          if (s.kind === "producer") {
            if (type === "checkout.evt.order.confirmed") setConfetti((n) => n + 1);
            if (DONE[type] && !pinned.has(s.service)) newDone[s.service as ServiceId] = { ...DONE[type]!, at: Date.now() };
          }
          const edge = edgeFor(s);
          if (!edge) continue;
          const ms = slowRef.current ? TRAVEL_MS.slow : TRAVEL_MS.mine;
          if (s.kind === "producer") send(key ?? s.spanId, destination(edge), ms, type);
          (newPulses[edge] ??= []).push({ id: s.spanId, ms, tone, label: type ? shortType(type) : "POST /orders", mine: true });
        }

        if (Object.keys(newFlashes).length) addFlashes(newFlashes);
        if (Object.keys(newDone).length) setDone((d) => ({ ...d, ...newDone }));
        if (Object.keys(newPulses).length) addPulses(newPulses);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    const t = setInterval(() => {
      setDone((d) => {
        const now = Date.now();
        const keep = Object.entries(d).filter(([, v]) => now - v.at < DONE_MS);
        return keep.length === Object.keys(d).length ? d : Object.fromEntries(keep);
      });
    }, 500);
    return () => clearInterval(t);
  }, []);

  return { pulses, flash, done, doing, busy, waiting, confetti };
}
