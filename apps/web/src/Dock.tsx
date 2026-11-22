import type { Item, OrderView, ProductView } from "@checkout/contracts";
import { useEffect, useRef, useState } from "react";
import { api, labActive, newTraceId, type LabState, type Pace } from "./api";
import { LabSheet } from "./LabSheet";
import { money } from "./format";
import { announceOwnRequest } from "./map/useLiveActivity";
import { Bag, Close, Flask, Minus, Plus, Refresh } from "./icons";

const CARD_LIMIT = 50_000;

interface Scenario {
  id: string;
  label: string;
  hint: string;
  items: Item[];
  primary?: boolean;
}

const SCENARIOS: Scenario[] = [
  { id: "happy", label: "Place an order", hint: "2 T-shirts and a mug. Reserve, capture, confirm.", items: [{ sku: "tee", quantity: 2 }, { sku: "mug", quantity: 1 }], primary: true },
  { id: "declined", label: "Declined card", hint: "3 keyboards, over the $500 card limit. Watch the stock get released.", items: [{ sku: "keyboard", quantity: 3 }] },
  { id: "stock", label: "Out of stock", hint: "4 pairs of sneakers, only 3 exist. Inventory says no; nothing to undo.", items: [{ sku: "sneakers", quantity: 4 }] },
];

const DEFAULT_HINT = "";

interface Props {
  lab: LabState | undefined;
  onLabChange: (next: LabState) => void;
  pace: Pace;
  onPace: (p: Pace) => void;
  products: ProductView[] | undefined;
  onPlacing: (traceId: string) => void;
  onPlaced: (order: OrderView) => void;
  onRestocked: (p: ProductView[]) => void;
}

export function Dock({ lab, onLabChange, pace, onPace, products, onPlacing, onPlaced, onRestocked }: Props) {
  // buttons never lock: each click is its own order; the gateway's rate limit guards the system.
  const [inFlight, setInFlight] = useState(0);
  const [cartPlaced, setCartPlaced] = useState(0);
  const [error, setError] = useState<string>();
  const [hint, setHint] = useState(DEFAULT_HINT);
  const [cartOpen, setCartOpen] = useState(false);
  const [labOpen, setLabOpen] = useState(false);
  const labOn = labActive(lab);

  // sheets close on a click outside the dock; the dock itself stays usable with a sheet open.
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!labOpen && !cartOpen) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setLabOpen(false);
      setCartOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [labOpen, cartOpen]);

  async function place(id: string, items: Item[]): Promise<boolean> {
    // the lab sheet covers the map.
    setLabOpen(false);
    setInFlight((n) => n + 1);
    setError(undefined);
    const hopDone = announceOwnRequest();
    try {
      const traceId = newTraceId();
      onPlacing(traceId);
      onPlaced(await api.placeOrder(items, crypto.randomUUID(), pace, traceId));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      hopDone();
      setInFlight((n) => n - 1);
    }
  }

  return (
    <div className="dock-wrap" ref={wrapRef}>
      {labOpen && <LabSheet state={lab} onChange={onLabChange} onClose={() => setLabOpen(false)} />}
      {cartOpen && (
        <Cart
          products={products}
          placed={cartPlaced}
          onClose={() => setCartOpen(false)}
          onCheckout={async (items) => {
            // the cart stays open, so the same basket can be ordered again.
            if (await place("cart", items)) setCartPlaced((n) => n + 1);
          }}
          onRestocked={onRestocked}
        />
      )}
      <div className="dock" role="group" aria-label="Place an order">
        <div className="pace" role="radiogroup" aria-label="Speed">
          {(["realtime", "slow"] as const).map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={pace === p}
              className={pace === p ? "is-on" : ""}
              onMouseEnter={() => setHint(p === "slow" ? "Slow: every service holds each message for a second so you can follow it." : "Real time: messages move as fast as the system does.")}
              onMouseLeave={() => setHint(DEFAULT_HINT)}
              onClick={() => onPace(p)}
            >
              {p === "slow" ? "Slow" : "Real time"}
            </button>
          ))}
        </div>
        <span className="dock-rule" aria-hidden="true" />
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            className={s.primary ? "btn btn-primary" : "btn btn-ghost"}
            aria-busy={inFlight > 0}
            aria-describedby="dock-hint"
            onMouseEnter={() => setHint(s.hint)}
            onMouseLeave={() => setHint(DEFAULT_HINT)}
            onFocus={() => setHint(s.hint)}
            onBlur={() => setHint(DEFAULT_HINT)}
            onClick={() => place(s.id, s.items)}
          >
            {s.label}
          </button>
        ))}
        <span className="dock-rule" aria-hidden="true" />
        <button
          className={`btn btn-ghost btn-icon ${cartOpen ? "is-on" : ""}`}
          aria-expanded={cartOpen}
          aria-controls="cart"
          aria-label="Build a cart"
          onClick={() => {
            setCartOpen((v) => !v);
            setLabOpen(false);
          }}
        >
          <Bag />
          <span className="label-long">Build a cart</span>
          <span className="label-short">Cart</span>
        </button>
        <button
          className={`btn btn-ghost btn-icon ${labOpen ? "is-on" : ""} ${labOn ? "is-armed" : ""}`}
          aria-expanded={labOpen}
          aria-controls="lab"
          aria-label="Failure lab"
          onClick={() => {
            setLabOpen((v) => !v);
            setCartOpen(false);
          }}
        >
          <Flask />
          <span className="label-long">Failure lab</span>
          <span className="label-short">Lab</span>
          {labOn && <i className="lab-dot" aria-hidden="true" />}
        </button>
      </div>
      <p id="dock-hint" className={`dock-hint ${error ? "is-error" : ""}`} aria-live="polite">
        {error
          ? `Couldn't place the order: ${error}`
          : inFlight > 1
            ? `Placing ${inFlight} orders…`
            : hint}
      </p>
    </div>
  );
}

function Cart({
  products,
  placed,
  onClose,
  onCheckout,
  onRestocked,
}: {
  products: ProductView[] | undefined;
  placed: number;
  onClose: () => void;
  onCheckout: (items: Item[]) => void;
  onRestocked: (p: ProductView[]) => void;
}) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [justPlaced, setJustPlaced] = useState(false);
  useEffect(() => {
    if (placed === 0) return;
    setJustPlaced(true);
    const t = setTimeout(() => setJustPlaced(false), 1500);
    return () => clearTimeout(t);
  }, [placed]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const items: Item[] = Object.entries(cart)
    .filter(([, q]) => q > 0)
    .map(([sku, quantity]) => ({ sku, quantity }));
  const priceOf = (sku: string) => products?.find((p) => p.sku === sku)?.price ?? 0;
  const total = items.reduce((sum, i) => sum + priceOf(i.sku) * i.quantity, 0);
  const bump = (sku: string, d: number) =>
    setCart((c) => ({ ...c, [sku]: Math.max(0, Math.min(20, (c[sku] ?? 0) + d)) }));

  return (
    <div className="sheet cart" id="cart" ref={ref} role="dialog" aria-label="Build a cart">
      <div className="sheet-head">
        <h2>Your cart</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close cart">
          <Close />
        </button>
      </div>
      <ul className="cart-list">
        {(products ?? []).map((p) => (
          <li key={p.sku}>
            <div className="cart-item">
              <span className="cart-name">{p.name}</span>
              <span className="cart-meta">
                <span className="num">{money(p.price)}</span>
                <span className={p.stock <= 3 ? "is-low" : ""}>{p.stock === 0 ? "sold out" : `${p.stock} left`}</span>
              </span>
            </div>
            <div className="stepper">
              <button onClick={() => bump(p.sku, -1)} disabled={!cart[p.sku]} aria-label={`One less ${p.name}`}>
                <Minus />
              </button>
              <span className="num" aria-live="polite">{cart[p.sku] ?? 0}</span>
              <button onClick={() => bump(p.sku, 1)} aria-label={`One more ${p.name}`}>
                <Plus />
              </button>
            </div>
          </li>
        ))}
        {!products && <li className="muted">Loading the catalogue…</li>}
      </ul>
      <div className="cart-foot">
        <div className="cart-total">
          <span>Total</span>
          <strong className="num">{money(total)}</strong>
        </div>
        {total > CARD_LIMIT && <p className="cart-warn">Over the $500 card limit, so the payment will be declined.</p>}
        <button className="btn btn-primary btn-wide" disabled={items.length === 0} onClick={() => onCheckout(items)}>
          {items.length === 0 ? "Add something first" : `Check out · ${money(total)}`}
        </button>
        <div className="cart-small">
          <span className={justPlaced ? "cart-placed" : ""} aria-live="polite">
            {justPlaced ? "Order placed. Check out again for another." : "The server prices the order, not this page."}
          </span>
          <button className="text-btn" onClick={async () => onRestocked(await api.restock())}>
            <Refresh width={16} height={16} /> Restock
          </button>
        </div>
      </div>
    </div>
  );
}
