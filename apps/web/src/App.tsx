import { useEffect, useState } from "react";
import { api } from "./api";
import { Graph } from "./Graph";
import { OrderDetail } from "./OrderDetail";
import { Notifications, Orders } from "./Orders";
import { Shop } from "./Shop";
import { traceStore, useStreamStatus } from "./traceStore";
import { usePoll } from "./usePoll";

const REPO = "https://github.com/kinqbert/checkout-saga";

export function App() {
  const [selected, setSelected] = useState<string>();
  const products = usePoll(api.products, 4000);
  const orders = usePoll(api.orders, 2500);
  const notes = usePoll(api.notifications, 3000);
  const status = useStreamStatus();

  // When a saga step lands, refresh lists right away instead of waiting for the next poll.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    return traceStore.subscribe((spans, live) => {
      if (!live || !spans.some((s) => s.kind === "consumer")) return;
      clearTimeout(t);
      t = setTimeout(() => {
        void orders.refresh();
        void products.refresh();
        void notes.refresh();
      }, 250);
    });
  }, [orders.refresh, products.refresh, notes.refresh]);

  useEffect(() => {
    if (!selected && orders.data?.[0]) setSelected(orders.data[0].id);
  }, [orders.data, selected]);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <div>
            <h1>Checkout Saga</h1>
            <p>Orchestrated saga · transactional outbox · NATS JetStream · OpenTelemetry</p>
          </div>
        </div>
        <div className="top-right">
          <span className={`stream stream-${status}`}>
            <i /> {status === "live" ? "live traces" : status === "connecting" ? "connecting…" : "traces offline"}
          </span>
          <a href="#how" className="link">How it works</a>
          <a href={REPO} className="link" target="_blank" rel="noreferrer">Source</a>
        </div>
      </header>

      <main className="layout">
        <aside className="col col-left">
          <Shop
            products={products.data}
            onPlaced={(id) => {
              setSelected(id);
              void orders.refresh();
              void products.refresh();
            }}
            onRestocked={(p) => products.setData(p)}
          />
        </aside>

        <section className="col col-center">
          <div className="panel graph-panel">
            <div className="panel-head">
              <h2>Services</h2>
              <span className="muted small">every dot is a real message, drawn from its span</span>
            </div>
            <Graph />
          </div>
          <OrderDetail orderId={selected} />
        </section>

        <aside className="col col-right">
          <Orders orders={orders.data} selected={selected} onSelect={setSelected} />
          <Notifications items={notes.data} />
          {(orders.error || products.error) && <p className="error">API unreachable: {orders.error ?? products.error}</p>}
        </aside>
      </main>

      <section id="how" className="how">
        <h2>How it works</h2>
        <div className="how-grid">
          <article>
            <h3>Orchestrated saga</h3>
            <p>
              The order service owns a pure state machine. Every event goes in, a new state and the next commands come
              out. Stock is reserved first because it is the easiest step to undo. Payment comes last because it is the
              step you can't take back.
            </p>
          </article>
          <article>
            <h3>Transactional outbox</h3>
            <p>
              A service never writes to Postgres and then publishes to NATS as two separate steps. The state change and
              the outgoing message are committed in one transaction. A relay then publishes outbox rows, so a crash can't
              lose a message or send one for a write that never happened.
            </p>
          </article>
          <article>
            <h3>Inbox &amp; idempotency</h3>
            <p>
              Delivery is at-least-once. Each consumer records the message id in its own inbox table, in the same
              transaction as its side effects, so a redelivered message does nothing. Checkout itself sends an
              Idempotency-Key, so retrying the POST doesn't create a second order.
            </p>
          </article>
          <article>
            <h3>One trace per order</h3>
            <p>
              The W3C <code>traceparent</code> is stored with each outbox row and sent as a NATS header. Every hop
              continues the same trace. Services export spans to a small relay, which streams them to this page.
            </p>
          </article>
        </div>
      </section>

      <footer className="foot">
        <span>NestJS · Postgres · Drizzle · NATS JetStream · OpenTelemetry · React Flow</span>
        <a href={REPO} className="link" target="_blank" rel="noreferrer">github.com/kinqbert/checkout-saga</a>
      </footer>
    </div>
  );
}
