import type { OrderView, TraceSpan } from "@checkout/contracts";
import { useEffect, useState } from "react";
import { api } from "./api";
import { isTerminal, money, shortId, STATE_LABEL } from "./format";
import { StateBadge } from "./Orders";
import { traceStore, useTraceVersion } from "./traceStore";
import { Waterfall } from "./Waterfall";

export function OrderDetail({ orderId }: { orderId: string | undefined }) {
  const [order, setOrder] = useState<OrderView>();
  const [fetched, setFetched] = useState<TraceSpan[]>([]);
  const version = useTraceVersion();

  useEffect(() => {
    setOrder(undefined);
    setFetched([]);
    if (!orderId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const o = await api.order(orderId);
        if (stop) return;
        setOrder(o);
        if (isTerminal(o.state)) {
          // Spans finish a moment after the last state change; poll briefly then stop.
          timer = setTimeout(async () => {
            if (o.traceId && traceStore.trace(o.traceId).length === 0) setFetched(await api.trace(o.traceId));
          }, 800);
          return;
        }
      } catch {
        /* keep polling */
      }
      if (!stop) timer = setTimeout(load, 600);
    };
    void load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [orderId]);

  if (!orderId) {
    return (
      <div className="panel detail empty-detail">
        <p className="muted">Place an order or pick one from the list to see its saga and trace.</p>
      </div>
    );
  }
  if (!order) return <div className="panel detail"><p className="muted">Loading…</p></div>;

  void version;
  const live = order.traceId ? traceStore.trace(order.traceId) : [];
  const spans = live.length > 0 ? live : fetched;
  const t0 = order.transitions?.[0] ? new Date(order.transitions[0].at).getTime() : 0;

  return (
    <div className="panel detail">
      <div className="panel-head">
        <h2>
          Order <span className="mono">{shortId(order.id)}</span>
        </h2>
        <StateBadge state={order.state} />
      </div>
      <div className="detail-lines">
        {order.lines.map((l) => (
          <span key={l.sku}>
            {l.quantity}× {l.name} <span className="muted">{money(l.unitPrice)}</span>
          </span>
        ))}
        <strong>{money(order.amount)}</strong>
      </div>

      <ol className="steps">
        {(order.transitions ?? []).map((t, i) => (
          <li key={i} className={`step state-${t.to}`}>
            <span className="step-state">{STATE_LABEL[t.to] ?? t.to}</span>
            <span className="step-cause mono">{t.cause.replace(/^checkout\.evt\./, "")}</span>
            <span className="step-time muted">+{new Date(t.at).getTime() - t0} ms</span>
          </li>
        ))}
      </ol>
      {order.cancelReason && <p className="reason">Reason: {order.cancelReason}</p>}

      <h3>Trace</h3>
      <Waterfall spans={spans} />
    </div>
  );
}
