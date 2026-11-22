import { useMemo, useState } from "react";
import { api, type Pace } from "./api";
import { Dock } from "./Dock";
import { Graph, useNarrow, type Insets } from "./Graph";
import { HowItWorks } from "./HowItWorks";
import { Book, GitHub } from "./icons";
import { useMyOrders } from "./myOrders";
import { OrderPanel } from "./OrderPanel";
import { Tracker } from "./Tracker";
import { useStreamStatus } from "./traceStore";
import { usePoll } from "./usePoll";

const REPO = "https://github.com/kinqbert/checkout-saga";

export function App() {
  const products = usePoll(api.products, 5000);
  // Failure lab state: polled quickly while something is broken, slowly otherwise.
  const [labFast, setLabFast] = useState(false);
  const lab = usePoll(api.lab, labFast ? 1000 : 6000);
  const labActive = !!lab.data && (!!lab.data.payment.downUntil || !!lab.data.inventory.downUntil || lab.data.inventory.crashArmed);
  if (labActive !== labFast) setLabFast(labActive);
  const mine = useMyOrders();
  const [selected, setSelected] = useState<string>();
  // "Your orders" is closed by default and only opens when asked.
  const [panelOpen, setPanelOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [pace, setPace] = useState<Pace>(() => {
    try {
      return localStorage.getItem("checkout-saga:pace") === "realtime" ? "realtime" : "slow";
    } catch {
      return "slow";
    }
  });
  const choosePace = (p: Pace) => {
    setPace(p);
    try {
      localStorage.setItem("checkout-saga:pace", p);
    } catch {
      /* not remembered; fine */
    }
  };
  const status = useStreamStatus();
  const narrow = useNarrow();

  const current = mine.list.find((o) => o.id === selected);
  const showPanel = panelOpen && !!current;

  // Room the map leaves for the floating UI. The order panel's space is always
  // reserved, so opening or closing it never moves the graph.
  const insets = useMemo<Insets>(
    () => (narrow ? { top: 172, right: 18, bottom: 372, left: 18 } : { top: 170, right: 430, bottom: 130, left: 60 }),
    [narrow],
  );

  return (
    <div className="stage">
      <Graph
        pathTraceId={showPanel ? current?.traceId ?? undefined : undefined}
        down={{ payment: !!lab.data?.payment.downUntil, inventory: !!lab.data?.inventory.downUntil }}
        slow={pace === "slow"} mine={mine.traceIds} focusState={showPanel ? current?.state : undefined} insets={insets} />

      <header className="masthead">
        <div className="brand">
          <svg className="mark" viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
            <rect width="32" height="32" rx="8" />
            <path d="M11 16 21 10M11 16l10 6" />
            <circle cx="10" cy="16" r="3.5" />
            <circle cx="22" cy="10" r="3" />
            <circle className="mark-accent" cx="22" cy="22" r="3" />
          </svg>
          <h1 className="title">Checkout saga</h1>
        </div>
        <p className="lede">Place an order and watch it cross five services. Every dot is a real message.</p>
        <p className="byline">
          Built by{" "}
          <a href="https://kinqbert.dev/" target="_blank" rel="noreferrer">
            Maksym Perekhodko
          </a>
        </p>
      </header>

      <nav className="corner" aria-label="About this demo">
        <span className={`live live-${status}`} role="status">
          <i />
          {status === "live" ? "Live" : status === "connecting" ? "Connecting" : "Offline"}
        </span>
        <button className="text-btn" aria-label="How it works" aria-expanded={howOpen} onClick={() => setHowOpen((v) => !v)}>
          <Book />
          <span>How it works</span>
        </button>
        <a className="btn" href={REPO} target="_blank" rel="noreferrer">
          <GitHub /> GitHub
        </a>
      </nav>

      {showPanel && current && (
        <OrderPanel compact={narrow} orders={mine.list} selectedId={current.id} onSelect={setSelected} onClose={() => setPanelOpen(false)} />
      )}
      {/* Your latest order, live, in the corner. The full panel is one click away. */}
      {!showPanel && mine.list[0] && (
        <Tracker
          order={mine.list[0]}
          onOpen={() => {
            setSelected(mine.list[0]!.id);
            setPanelOpen(true);
          }}
        />
      )}
      {!showPanel && mine.list.length > 0 && (
        <button
          className="btn reopen"
          onClick={() => {
            if (!current) setSelected(mine.list[0]!.id);
            setPanelOpen(true);
          }}
        >
          {mine.list.length > 1 ? "Your orders" : "Your order"}
        </button>
      )}

      <div className="legend" aria-label="Legend">
        <span><i className="tone-info" />Your messages</span>
        <span><i className="ghost" />Other visitors</span>
      </div>

      <Dock
        lab={lab.data}
        onLabChange={(next) => {
          lab.setData(next);
          setLabFast(true);
        }}
        pace={pace}
        onPace={choosePace}
        products={products.data}
        onPlacing={mine.claim}
        onPlaced={(order) => {
          mine.add(order);
          setSelected(order.id);
          void products.refresh();
        }}
        onRestocked={(p) => products.setData(p)}
      />

      {howOpen && <HowItWorks onClose={() => setHowOpen(false)} />}
    </div>
  );
}
