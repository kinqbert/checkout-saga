import { useMemo, useState } from "react";
import { api, labActive, type Pace } from "./api";
import { Dock } from "./Dock";
import { Graph, type Insets } from "./map/Graph";
import { PHONE, useMedia } from "./map/useMedia";
import { HowItWorks } from "./HowItWorks";
import { Book, GitHub } from "./icons";
import { useMyOrders } from "./myOrders";
import { OrderPanel } from "./OrderPanel";
import { useFavicon } from "./favicon";
import { useStreamStatus } from "./traceStore";
import { usePoll } from "./usePoll";

const REPO = "https://github.com/kinqbert/checkout-saga";

export function App() {
  const products = usePoll(api.products, 5000);
  // polled quickly while something is broken.
  const [labFast, setLabFast] = useState(false);
  const lab = usePoll(api.lab, labFast ? 1000 : 6000);
  const labOn = labActive(lab.data);
  if (labOn !== labFast) setLabFast(labOn);
  const mine = useMyOrders();
  const [selected, setSelected] = useState<string>();
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
      // not remembered; fine
    }
  };
  const status = useStreamStatus();
  const narrow = useMedia(PHONE);

  const current = mine.list.find((o) => o.id === selected);
  const latest = mine.list[0];
  const running = latest && latest.state !== "CONFIRMED" && latest.state !== "CANCELLED" ? latest : undefined;
  useFavicon(mine.list[0]?.state);
  const showPanel = panelOpen && !!current;

  // room for the floating UI; on desktop the map slides left while the order panel is open.
  const insets = useMemo<Insets>(
    () =>
      narrow
        ? { top: 172, right: 18, bottom: 372, left: 18 }
        : { top: 170, right: showPanel ? 430 : 60, bottom: 130, left: 60 },
    [narrow, showPanel],
  );

  return (
    <div className="stage">
      <Graph
        pathTraceId={showPanel ? current?.traceId ?? undefined : undefined}
        down={{ payment: !!lab.data?.payment.downUntil, inventory: !!lab.data?.inventory.downUntil }}
        slow={pace === "slow"} mine={mine.traceIds} focus={showPanel ? current : running} insets={insets} />

      <header className="masthead">
        <div className="brand">
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
