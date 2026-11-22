import type { NotificationView, OrderView, TraceSpan } from "@checkout/contracts";
import { useEffect, useState } from "react";
import { api } from "./api";
import { isTerminal, money, ms, shortId, STATE_LABEL } from "./format";
import { Chevron, Close } from "./icons";
import { SagaSteps, STATE_TONE } from "./SagaSteps";
import { traceStore, useTraceVersion } from "./traceStore";
import { Waterfall } from "./Waterfall";

interface Props {
  // phones: show only the state line until the visitor asks for details.
  compact?: boolean;
  orders: OrderView[];
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function OrderPanel({ compact = false, orders, selectedId, onSelect, onClose }: Props) {
  const order = orders.find((o) => o.id === selectedId);
  const [traceOpen, setTraceOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [fetched, setFetched] = useState<TraceSpan[]>([]);
  const [note, setNote] = useState<NotificationView>();
  useTraceVersion();

  const terminal = order ? isTerminal(order.state) : false;

  // the e-mail arrives just after the saga ends; look for it then.
  useEffect(() => {
    setNote(undefined);
    if (!order || !terminal) return;
    let stop = false;
    let tries = 0;
    const look = async () => {
      const list = await api.notifications().catch(() => []);
      if (stop) return;
      const mine = list.find((n) => n.orderId === order.id);
      if (mine) setNote(mine);
      else if (++tries < 8) setTimeout(look, 700);
    };
    void look();
    return () => {
      stop = true;
    };
  }, [order?.id, terminal]); // eslint-disable-line react-hooks/exhaustive-deps

  // older orders may have scrolled out of the live buffer: fetch their trace once.
  useEffect(() => {
    setFetched([]);
    if (!order?.traceId || !terminal) return;
    const id = order.traceId;
    const t = setTimeout(async () => {
      if (traceStore.trace(id).length === 0) setFetched(await api.trace(id).catch(() => []));
    }, 900);
    return () => clearTimeout(t);
  }, [order?.traceId, terminal]);

  if (!order) return null;

  const live = order.traceId ? traceStore.trace(order.traceId) : [];
  const spans = live.length > 0 ? live : fetched;
  const total = spans.length ? Math.max(...spans.map((s) => s.startMs + s.durationMs)) - Math.min(...spans.map((s) => s.startMs)) : 0;
  const tone = STATE_TONE[order.state] ?? "info";
  const label = STATE_LABEL[order.state] ?? order.state;

  const showBody = !compact || expanded;

  return (
    <aside className={`sheet panel ${compact ? "is-compact" : ""} ${showBody ? "is-open" : ""}`} aria-label="Your order">
      <div className="sheet-head">
        <h2 className={`panel-title tone-${tone}`} aria-live="polite" title={`Order ${shortId(order.id)}`}>
          <i className={`status-dot ${terminal ? "" : "is-live"}`} />
          {label}
        </h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close order panel">
          <Close />
        </button>
      </div>
      <p className="panel-sub">
        {order.lines.map((l) => `${l.quantity}× ${l.name}`).join(", ")}
        <span className="dot-sep" aria-hidden="true" />
        <span className="num">{money(order.amount)}</span>
      </p>

      {compact && (
        <button className="trace-toggle details-toggle" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          <span>{expanded ? "Fewer details" : "Steps, e-mail and trace"}</span>
          <Chevron className="chev" />
        </button>
      )}

      {showBody && (
        <>
      {!traceOpen && orders.length > 1 && (
        <div className="history" role="group" aria-label="Your orders">
          {orders.map((o) => (
            <button
              key={o.id}
              className={`history-item tone-${STATE_TONE[o.state] ?? "info"} ${o.id === order.id ? "is-on" : ""}`}
              onClick={() => onSelect(o.id)}
              aria-pressed={o.id === order.id}
              title={`${shortId(o.id)} · ${STATE_LABEL[o.state] ?? o.state} · ${money(o.amount)}`}
            >
              <i />
              <span className="mono">{shortId(o.id).slice(0, 4)}</span>
            </button>
          ))}
        </div>
      )}

      {!traceOpen && <SagaSteps order={order} />}

      {order.cancelReason && <p className="reason">{order.cancelReason}</p>}
      {/* one closing line per order: the reason if it was cancelled, the receipt if confirmed. */}
      {!traceOpen && note && !order.cancelReason && (
        <p className="mail" title={note.message}>
          <span className="mono">notify</span> Receipt e-mailed
        </p>
      )}

      <div className="trace">
        <button className="trace-toggle" aria-expanded={traceOpen} onClick={() => setTraceOpen((v) => !v)}>
          <span>{traceOpen ? "Back to the steps" : "Show the trace"}</span>
          <span className="mono num">
            {spans.length} spans{total ? ` · ${ms(total)}` : ""}
          </span>
          <Chevron className="chev" />
        </button>
        {traceOpen && <Waterfall spans={spans} />}
      </div>
        </>
      )}
    </aside>
  );
}
