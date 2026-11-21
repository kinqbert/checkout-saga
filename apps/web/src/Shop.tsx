import type { Item, ProductView } from "@checkout/contracts";
import { useState } from "react";
import { api } from "./api";
import { money } from "./format";

const CARD_LIMIT = 50_000;

const SCENARIOS: { name: string; hint: string; tone: string; items: Item[] }[] = [
  { name: "Happy path", hint: "reserve → capture → confirm", tone: "ok", items: [{ sku: "tee", quantity: 2 }, { sku: "mug", quantity: 1 }] },
  { name: "Card declined", hint: "over $500, stock gets released", tone: "comp", items: [{ sku: "keyboard", quantity: 3 }] },
  { name: "Out of stock", hint: "inventory rejects, nothing to undo", tone: "fail", items: [{ sku: "sneakers", quantity: 4 }] },
];

interface Props {
  products: ProductView[] | undefined;
  onPlaced: (orderId: string) => void;
  onRestocked: (p: ProductView[]) => void;
}

export function Shop({ products, onPlaced, onRestocked }: Props) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const items: Item[] = Object.entries(cart)
    .filter(([, q]) => q > 0)
    .map(([sku, quantity]) => ({ sku, quantity }));
  const priceOf = (sku: string) => products?.find((p) => p.sku === sku)?.price ?? 0;
  const total = items.reduce((sum, i) => sum + priceOf(i.sku) * i.quantity, 0);

  async function place(list: Item[]) {
    setBusy(true);
    setError(undefined);
    // One key per click: if the request is retried, the server returns the same order.
    const key = crypto.randomUUID();
    try {
      const order = await api.placeOrder(list, key);
      onPlaced(order.id);
      setCart({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const bump = (sku: string, d: number) =>
    setCart((c) => ({ ...c, [sku]: Math.max(0, Math.min(20, (c[sku] ?? 0) + d)) }));

  return (
    <div className="panel shop">
      <div className="panel-head">
        <h2>Try a scenario</h2>
      </div>
      <div className="scenarios">
        {SCENARIOS.map((s) => (
          <button key={s.name} className={`scenario tone-border-${s.tone}`} disabled={busy} onClick={() => place(s.items)}>
            <span className="scenario-name">{s.name}</span>
            <span className="scenario-hint">{s.hint}</span>
          </button>
        ))}
      </div>

      <div className="panel-head">
        <h2>Or build a cart</h2>
        <button
          className="link"
          onClick={async () => {
            try {
              onRestocked(await api.restock());
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Restock
        </button>
      </div>
      <ul className="products">
        {(products ?? []).map((p) => (
          <li key={p.sku} className="product">
            <div className="product-info">
              <span className="product-name">{p.name}</span>
              <span className="product-meta">
                {money(p.price)} · <span className={p.stock <= 3 ? "low" : ""}>{p.stock} left</span>
              </span>
            </div>
            <div className="stepper">
              <button aria-label={`remove ${p.name}`} onClick={() => bump(p.sku, -1)} disabled={!cart[p.sku]}>
                −
              </button>
              <span>{cart[p.sku] ?? 0}</span>
              <button aria-label={`add ${p.name}`} onClick={() => bump(p.sku, 1)}>
                +
              </button>
            </div>
          </li>
        ))}
        {!products && <li className="muted">Loading products…</li>}
      </ul>
      <div className="checkout">
        <div className="total">
          <span>Total</span>
          <strong>{money(total)}</strong>
        </div>
        {total > CARD_LIMIT && <p className="warn">Over the $500 card limit: payment will be declined.</p>}
        <button className="primary" disabled={busy || items.length === 0} onClick={() => place(items)}>
          {busy ? "Placing…" : "Checkout"}
        </button>
        {error && <p className="error">{error}</p>}
        <p className="fine">Prices come from the server, never from this page.</p>
      </div>
    </div>
  );
}
