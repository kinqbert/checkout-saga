import type { OrderView } from "@checkout/contracts";
import { useEffect, useRef } from "react";
import { confetti } from "./confetti";
import { money, shortId } from "./format";
import { SagaSteps } from "./SagaSteps";

// Confetti only for an order this page watched run, and only once, even if
// the tracker is hidden and shown again.
const seenRunning = new Set<string>();
const celebrated = new Set<string>();

/**
 * Bottom-right: your latest order's path, filling in live. Confetti when it
 * is confirmed (latest order only, once).
 */
export function Tracker({ order, onOpen }: { order: OrderView; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const total = order.transitions?.length
    ? new Date(order.transitions.at(-1)!.at).getTime() - new Date(order.transitions[0]!.at).getTime()
    : 0;
  const finished = order.state === "CONFIRMED" || order.state === "CANCELLED";

  if (!finished) seenRunning.add(order.id);

  useEffect(() => {
    if (order.state !== "CONFIRMED" || !seenRunning.has(order.id) || celebrated.has(order.id) || !ref.current) return;
    celebrated.add(order.id);
    const r = ref.current.getBoundingClientRect();
    confetti(r.left + r.width / 2, r.top + 8);
  }, [order.id, order.state]);

  return (
    <button ref={ref} className={`tracker state-${order.state}`} onClick={onOpen} aria-label="Open your latest order">
      <span className="tracker-head">
        <span className="tracker-title">Latest order</span>
        <span className="tracker-meta mono">
          {shortId(order.id)} · {money(order.amount)}
          {finished && total > 0 ? ` · ${(total / 1000).toFixed(1)} s` : ""}
        </span>
      </span>
      <SagaSteps order={order} />
    </button>
  );
}
