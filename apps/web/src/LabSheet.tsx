import { useEffect, useRef, useState } from "react";
import { api, type LabService, type LabState } from "./api";
import { Close } from "./icons";

const secondsLeft = (until: string | null, now: number) =>
  until ? Math.min(60, Math.max(0, Math.ceil((new Date(until).getTime() - now) / 1000))) : 0;

/**
 * Failure lab: three guided experiments. Every switch applies to this
 * visitor's orders only, and outages end on their own after 60 s.
 */
export function LabSheet({
  state,
  onChange,
  onClose,
}: {
  state: LabState | undefined;
  onChange: (next: LabState) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string>();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearInterval(t);
    };
  }, [onClose]);

  async function flip(service: LabService, fault: "down" | "crash", on: boolean) {
    setError(undefined);
    try {
      const snap = await api.setLab(service, fault, on);
      if (state) onChange({ ...state, [service]: snap });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const outage = (service: LabService, title: string, watch: string) => {
    const left = secondsLeft(state?.[service].downUntil ?? null, now);
    const down = left > 0;
    return (
      <li className={`lab-row ${down ? "is-active" : ""}`}>
        <div className="lab-text">
          <span className="lab-title">{title}</span>
          <span className="lab-watch">{down ? `Down for your orders. Back on its own in ${left}s.` : watch}</span>
        </div>
        <button className={down ? "btn btn-primary" : "btn"} onClick={() => flip(service, "down", !down)} disabled={!state}>
          {down ? "Bring back" : "Take down"}
        </button>
      </li>
    );
  };

  const armed = !!state?.inventory.crashArmed;
  return (
    <div className="sheet lab" id="lab" ref={ref} role="dialog" aria-label="Failure lab">
      <div className="sheet-head">
        <h2>Failure lab</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close failure lab">
          <Close />
        </button>
      </div>
      <p className="lab-lede">Break a service, then place an order and watch the system recover.</p>
      <ul className="lab-list">
        {outage("payment", "Payment outage", "Orders stop at payment and queue up. Bring it back and they all finish.")}
        {outage("inventory", "Inventory outage", "Reservations wait in the queue. Nothing is lost.")}
        <li className={`lab-row ${armed ? "is-active" : ""}`}>
          <div className="lab-text">
            <span className="lab-title">Crash before ack</span>
            <span className="lab-watch">
              {armed
                ? "Armed. Place an order: Inventory commits, crashes, gets the message again, and the inbox ignores it."
                : "Inventory does the work, crashes before confirming, and receives the message twice."}
            </span>
          </div>
          <button className={armed ? "btn btn-primary" : "btn"} onClick={() => flip("inventory", "crash", !armed)} disabled={!state}>
            {armed ? "Disarm" : "Arm"}
          </button>
        </li>
      </ul>
      {error && <p className="lab-error">{error}</p>}
      <p className="lab-foot">Only your orders are affected. Outages switch themselves off after 60 seconds.</p>
    </div>
  );
}
