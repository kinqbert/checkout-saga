import type { OrderView } from "@checkout/contracts";
import { isTerminal, STATE_LABEL } from "./format";

export const STATE_TONE: Record<string, string> = {
  AWAITING_STOCK: "info",
  AWAITING_PAYMENT: "info",
  RELEASING_STOCK: "comp",
  CONFIRMED: "ok",
  CANCELLED: "fail",
};

// timeline notes that don't move the saga: a late success being undone, a refund confirming.
const NOTE: Record<string, string> = {
  "checkout.evt.inventory.reserved": "Stock reserved too late, released",
  "checkout.evt.payment.captured": "Payment arrived too late, refund sent",
  "checkout.evt.payment.refunded": "Late payment refunded",
};

function nextStep(state: string): string | undefined {
  switch (state) {
    case "AWAITING_STOCK":
      return "Waiting for inventory";
    case "AWAITING_PAYMENT":
      return "Waiting for the card";
    case "RELEASING_STOCK":
      return "Waiting for stock to return";
    default:
      return undefined;
  }
}

export function SagaSteps({ order }: { order: OrderView }) {
  const transitions = order.transitions ?? [];
  const t0 = transitions[0] ? new Date(transitions[0].at).getTime() : 0;
  const terminal = isTerminal(order.state);
  const next = nextStep(order.state);
  return (
    <ol className="steps">
      {transitions.map((t, i) =>
        t.from === t.to ? (
          <li key={`note-${i}`} className="step is-note tone-comp" title={`Triggered by ${t.cause.replace(/^checkout\.evt\./, "")}`}>
            <i className="step-dot" />
            <span className="step-name">{NOTE[t.cause] ?? t.cause}</span>
            <span className="step-time mono num">+{new Date(t.at).getTime() - t0} ms</span>
          </li>
        ) : (
        <li
          key={`${t.to}-${i}`}
          className={`step tone-${STATE_TONE[t.to] ?? "info"} ${i === transitions.length - 1 && !terminal ? "is-current" : ""}`}
          title={`Triggered by ${t.cause.replace(/^checkout\.evt\./, "")}`}
        >
          <i className="step-dot" />
          <span className="step-name">{STATE_LABEL[t.to] ?? t.to}</span>
          <span className="step-time mono num">+{new Date(t.at).getTime() - t0} ms</span>
        </li>
        ),
      )}
      {next && (
        <li key={`next-${order.state}`} className="step is-pending">
          <i className="step-dot" />
          <span className="step-name">{next}</span>
        </li>
      )}
    </ol>
  );
}
