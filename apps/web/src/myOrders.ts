import type { OrderView } from "@checkout/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { isTerminal } from "./format";
import { traceStore } from "./traceStore";

const KEY = "checkout-saga:my-orders";
const MAX = 5;

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function save(ids: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* private mode: orders just aren't remembered across reloads */
  }
}

/**
 * Two fetches of one order can race (the poll and the refetch a saga step
 * triggers), and the older answer may arrive last. A saga only moves forward,
 * so keep whichever view has seen more transitions.
 */
function newer(prev: OrderView | undefined, next: OrderView): OrderView {
  if (!prev) return next;
  const p = prev.transitions?.length ?? 0;
  const n = next.transitions?.length ?? 0;
  if (n !== p) return n > p ? next : prev;
  return next.updatedAt >= prev.updatedAt ? next : prev;
}

function merge(orders: Record<string, OrderView>, fresh: OrderView[]): Record<string, OrderView> {
  const out = { ...orders };
  for (const f of fresh) out[f.id] = newer(out[f.id], f);
  return out;
}

/**
 * The visitor's own orders, newest first, remembered in this browser. Each one
 * is polled until its saga finishes, so the panel follows it live.
 */
export function useMyOrders() {
  const [ids, setIds] = useState<string[]>(load);
  const [orders, setOrders] = useState<Record<string, OrderView>>({});
  const ordersRef = useRef(orders);
  ordersRef.current = orders;

  // Every order placed in this session counts as yours for the map (colour,
  // spinners), even after it drops out of the 5 shown in the panel.
  const ownTraces = useRef(new Set<string>());

  /** Marks a trace as yours before its request leaves (the browser chose the id). */
  const claim = useCallback((traceId: string) => {
    ownTraces.current.add(traceId);
    if (ownTraces.current.size > 1000) ownTraces.current.delete(ownTraces.current.values().next().value!);
  }, []);

  const add = useCallback((order: OrderView) => {
    if (order.traceId) claim(order.traceId);
    setOrders((o) => merge(o, [order]));
    setIds((prev) => {
      const next = [order.id, ...prev.filter((x) => x !== order.id)].slice(0, MAX);
      save(next);
      return next;
    });
  }, [claim]);

  // Refetch an order the moment its saga moves (an order-service consumer span
  // for one of our traces), so the panel keeps time with the dots on the map.
  useEffect(() => {
    const pendingFetch = new Map<string, ReturnType<typeof setTimeout>>();
    const unsub = traceStore.subscribe((spans) => {
      for (const s of spans) {
        if (s.service !== "order" || s.kind !== "consumer") continue;
        const order = Object.values(ordersRef.current).find((o) => o.traceId === s.traceId);
        if (!order || pendingFetch.has(order.id)) continue;
        pendingFetch.set(
          order.id,
          setTimeout(async () => {
            pendingFetch.delete(order.id);
            const fresh = await api.order(order.id).catch(() => undefined);
            if (fresh) setOrders((o) => merge(o, [fresh]));
          }, 30),
        );
      }
    });
    return () => {
      unsub();
      for (const t of pendingFetch.values()) clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const pending = ids.filter((id) => !ordersRef.current[id] || !isTerminal(ordersRef.current[id]!.state) || !ordersRef.current[id]!.transitions);
      const results = await Promise.all(pending.map((id) => api.order(id).catch(() => undefined)));
      if (stop) return;
      const fresh = results.filter((o): o is OrderView => !!o);
      if (fresh.length) setOrders((o) => merge(o, fresh));
      // Forget orders the server no longer knows (e.g. the demo database was reset).
      const gone = pending.filter((id, i) => !results[i] && !ordersRef.current[id]);
      if (gone.length) setIds((prev) => { const next = prev.filter((x) => !gone.includes(x)); save(next); return next; });
      timer = setTimeout(tick, pending.length ? 600 : 3000);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [ids]);

  const list = ids.map((id) => orders[id]).filter((o): o is OrderView => !!o);
  // Orders restored from a previous visit count as yours too.
  for (const o of list) if (o.traceId) ownTraces.current.add(o.traceId);
  return { list, add, claim, traceIds: ownTraces.current };
}
