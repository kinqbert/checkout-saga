import { useEffect, useRef, useState } from "react";
import { api, type LabFault, type LabService, type LabState } from "./api";
import { Close } from "./icons";

const secondsLeft = (until: string | null, now: number) =>
  until ? Math.min(60, Math.max(0, Math.ceil((new Date(until).getTime() - now) / 1000))) : 0;

/**
 * Failure lab: five guided experiments. Every switch applies to this
 * visitor's orders only (killing Order restarts it for everyone, briefly),
 * and faults end on their own after 60 s.
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

  async function flip(service: LabService, fault: LabFault, on: boolean) {
    setError(undefined);
    try {
      const snap = await api.setLab(service, fault, on);
      if (state) onChange({ ...state, [service]: snap });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** A fault that stays on for up to 60 s. */
  const timed = (service: LabService, fault: "down" | "slow", title: string, watch: string, active: string, labels: [string, string]) => {
    const until = fault === "down" ? state?.[service]?.downUntil : state?.[service]?.slowUntil;
    const left = secondsLeft(until ?? null, now);
    const on = left > 0;
    return (
      <li className={`lab-row ${on ? "is-active" : ""}`}>
        <div className="lab-text">
          <span className="lab-title">{title}</span>
          <span className="lab-watch">{on ? `${active} Back to normal in ${left}s.` : watch}</span>
        </div>
        <button className={on ? "btn btn-primary" : "btn"} onClick={() => flip(service, fault, !on)} disabled={!state?.[service]}>
          {on ? labels[1] : labels[0]}
        </button>
      </li>
    );
  };

  /** A one-shot fault: it fires on the next order, then disarms. */
  const oneShot = (service: LabService, fault: "crash" | "kill", title: string, watch: string, active: string) => {
    const snap = state?.[service];
    const armed = !!(fault === "crash" ? snap?.crashArmed : snap?.killArmed);
    return (
      <li className={`lab-row ${armed ? "is-active" : ""}`}>
        <div className="lab-text">
          <span className="lab-title">{title}</span>
          <span className="lab-watch">{armed ? active : watch}</span>
        </div>
        <button className={armed ? "btn btn-primary" : "btn"} onClick={() => flip(service, fault, !armed)} disabled={!snap}>
          {armed ? "Disarm" : "Arm"}
        </button>
      </li>
    );
  };

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
        {timed(
          "payment",
          "down",
          "Payment outage",
          "Orders queue at payment. Back within 20 s and they finish; later, the order times out, releases the stock and cancels.",
          "Down for your orders.",
          ["Take down", "Bring back"],
        )}
        {timed(
          "inventory",
          "down",
          "Inventory outage",
          "Reservations wait in the queue. Nothing is lost, but after 20 s the order stops waiting and cancels.",
          "Down for your orders.",
          ["Take down", "Bring back"],
        )}
        {timed(
          "payment",
          "slow",
          "Slow card provider",
          "The card is charged only after the order gave up. The order times out, and the late charge is refunded.",
          "Answering late for your orders.",
          ["Slow down", "Speed up"],
        )}
        {oneShot(
          "inventory",
          "crash",
          "Crash before ack",
          "Inventory does the work, crashes before confirming, and receives the message twice.",
          "Armed. Place an order: Inventory commits, crashes, gets the message again, and the inbox ignores it.",
        )}
        {oneShot(
          "order",
          "kill",
          "Kill Order mid-saga",
          "The Order process really exits after it moves your saga on, then restarts and continues from the database.",
          "Armed. Place an order: Order stores the next step, dies, restarts in a few seconds, and finishes the saga. (Everyone's orders pause for that moment.)",
        )}
      </ul>
      {error && <p className="lab-error">{error}</p>}
      <p className="lab-foot">Only your orders are affected, except while Order restarts. Faults switch themselves off after 60 seconds.</p>
    </div>
  );
}
