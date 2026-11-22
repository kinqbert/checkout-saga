import { useEffect, useRef } from "react";
import { Close } from "./icons";


export function HowItWorks({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="sheet drawer" ref={ref} role="dialog" aria-label="How it works">
      <div className="sheet-head">
        <h2 className="drawer-title">How it works</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <Close />
        </button>
      </div>
      <p className="drawer-lede">
        Five NestJS services keep one order consistent without a distributed transaction. Every message goes through
        NATS JetStream, and nothing you see on the map is scripted.
      </p>

      <section>
        <h3>An orchestrated saga</h3>
        <p>
          The order service runs a small, pure state machine: an event comes in, and a new state and the next commands
          come out. Stock is reserved first because it's the easiest step to undo. Payment comes last because it's the
          one you can't take back. When the card is declined, the saga releases the stock.
        </p>
      </section>
      <section>
        <h3>A transactional outbox</h3>
        <p>
          A service never saves and then publishes in two separate steps. The state change and its outgoing message are
          committed in one Postgres transaction, and a relay publishes them afterwards. A crash can't lose a message or
          send one for a write that never happened.
        </p>
      </section>
      <section>
        <h3>An inbox on every consumer</h3>
        <p>
          Delivery is at least once. Each consumer records the message id in the same transaction as its work, so a
          redelivered message changes nothing. The checkout request carries an idempotency key, so a retry can't
          create a second order.
        </p>
      </section>
      <section>
        <h3>One trace per order</h3>
        <p>
          The trace context is stored with each outbox row and sent as a NATS header, so every hop continues the same
          OpenTelemetry trace. Services stream their spans to a small relay, and this page draws them as they land.
        </p>
      </section>

      <p className="drawer-credit">
        Designed and built by{" "}
        <a href="https://kinqbert.dev/" target="_blank" rel="noreferrer">
          Maksym Perekhodko
        </a>
        .
      </p>
    </aside>
  );
}
