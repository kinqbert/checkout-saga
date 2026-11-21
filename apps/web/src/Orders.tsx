import type { NotificationView, OrderView } from "@checkout/contracts";
import { ago, money, shortId, STATE_LABEL } from "./format";

export function StateBadge({ state }: { state: string }) {
  return <span className={`badge state-${state}`}>{STATE_LABEL[state] ?? state}</span>;
}

export function Orders({
  orders,
  selected,
  onSelect,
}: {
  orders: OrderView[] | undefined;
  selected: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Recent orders</h2>
        <span className="muted small">everyone's, live</span>
      </div>
      <ul className="orders">
        {(orders ?? []).map((o) => (
          <li key={o.id}>
            <button className={`order-row ${o.id === selected ? "is-selected" : ""}`} onClick={() => onSelect(o.id)}>
              <span className="order-id">
                <span className="mono">{shortId(o.id)}</span>
                <span className="muted small">{ago(o.createdAt)}</span>
              </span>
              <span className="order-amount">{money(o.amount)}</span>
              <StateBadge state={o.state} />
            </button>
          </li>
        ))}
        {orders?.length === 0 && <li className="muted empty">No orders yet. Try a scenario.</li>}
      </ul>
    </div>
  );
}

export function Notifications({ items }: { items: NotificationView[] | undefined }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Outbox of e-mails</h2>
        <span className="muted small">notify service</span>
      </div>
      <ul className="notes">
        {(items ?? []).map((n) => (
          <li key={n.id} className={`note note-${n.kind}`}>
            <span>{n.message}</span>
            <span className="muted small">{ago(n.createdAt)}</span>
          </li>
        ))}
        {items?.length === 0 && <li className="muted empty">Nothing sent yet.</li>}
      </ul>
    </div>
  );
}
