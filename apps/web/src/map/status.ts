import type { TraceSpan } from "@checkout/contracts";
import { STATE_LABEL, type Tone } from "../format";
import type { ServiceId } from "./model";

export interface Status {
  text: string;
  tone: Tone;
  doing?: boolean;
  // identity for the fade-in: a ticking countdown keeps it, a new status changes it
  id?: string;
}

export type Stamped<T> = T & { at: number };

export const DONE_MS = 3000;

export const DOING: Record<string, string> = {
  http: "Placing order…",
  "checkout.cmd.inventory.reserve": "Reserving stock…",
  "checkout.cmd.inventory.release": "Releasing stock…",
  "checkout.cmd.payment.capture": "Charging card…",
  "checkout.cmd.payment.refund": "Refunding late charge…",
  "checkout.evt.payment.refunded": "Handling refund…",
  "checkout.evt.inventory.reserved": "Handling stock reply…",
  "checkout.evt.inventory.rejected": "Handling stock reply…",
  "checkout.evt.inventory.released": "Handling stock reply…",
  "checkout.evt.payment.captured": "Handling payment reply…",
  "checkout.evt.payment.failed": "Handling payment reply…",
  "checkout.evt.order.confirmed": "Emailing confirmation…",
  "checkout.evt.order.cancelled": "Emailing cancellation…",
};

export const DONE: Record<string, Status> = {
  "checkout.cmd.inventory.reserve": { text: "Asked for stock", tone: "info" },
  "checkout.cmd.inventory.release": { text: "Asked to release stock", tone: "comp" },
  "checkout.cmd.payment.capture": { text: "Asked for payment", tone: "info" },
  "checkout.cmd.payment.refund": { text: "Asked for a refund", tone: "comp" },
  "checkout.evt.payment.refunded": { text: "Late charge refunded", tone: "comp" },
  "checkout.evt.inventory.reserved": { text: "Stock reserved", tone: "ok" },
  "checkout.evt.inventory.rejected": { text: "Out of stock", tone: "fail" },
  "checkout.evt.inventory.released": { text: "Stock released", tone: "comp" },
  "checkout.evt.payment.captured": { text: "Payment captured", tone: "ok" },
  "checkout.evt.payment.failed": { text: "Card declined", tone: "fail" },
  "checkout.evt.order.confirmed": { text: "Order confirmed", tone: "ok" },
  "checkout.evt.order.cancelled": { text: "Order cancelled", tone: "fail" },
};

// Notify sends nothing back, so its result comes from the message it handled.
export const NOTIFY_DONE: Record<string, Status> = {
  "checkout.evt.order.confirmed": { text: "Confirmation emailed", tone: "ok" },
  "checkout.evt.order.cancelled": { text: "Cancellation emailed", tone: "fail" },
};

// spans worth a note of their own; `pin` keeps it over the messages sent right after.
export function notableSpan(s: TraceSpan): (Status & { pin?: boolean }) | undefined {
  const a = s.attributes;
  if (s.kind === "producer" && a["messaging.nats.duplicate"]) return { text: "Re-sent, copy dropped", tone: "comp", pin: true };
  if (a["demo.lab.crashed"]) return { text: "Crashed before ack", tone: "fail" };
  if (a["demo.lab.killed"]) return { text: "Killed, restarting…", tone: "fail", pin: true };
  if (s.name === "saga timeout")
    return { text: `Timed out on ${a["checkout.saga.waiting_in"] === "AWAITING_STOCK" ? "inventory" : "payment"}`, tone: "fail", pin: true };
  if (a["checkout.inbox.duplicate"]) return { text: "Duplicate ignored", tone: "comp" };
  return undefined;
}

export interface Focus {
  state: string;
  deadline: number | undefined;
}

// refusals win, then the newer of "working on" and "just did", then (Order) your saga's countdown.
export function cardStatus(
  id: ServiceId,
  s: {
    waiting: { count: number; retry: number } | undefined;
    doing: Stamped<{ text: string }> | undefined;
    done: Stamped<Status> | undefined;
    focus: Focus | undefined;
    now: number;
  },
): Status | undefined {
  const { waiting, doing, done, focus, now } = s;
  if (waiting && waiting.count > 0) return { text: `Down · ${waiting.count} waiting, retry #${waiting.retry}`, tone: "fail", id: "down" };
  if (doing && (!done || doing.at > done.at)) return { text: doing.text, tone: "info", doing: true };
  if (done) return { text: done.text, tone: done.tone };
  if (id !== "order" || !focus || !STATE_LABEL[focus.state] || focus.state === "CONFIRMED" || focus.state === "CANCELLED") return undefined;

  const waitingOn = { AWAITING_STOCK: "stock", AWAITING_PAYMENT: "payment" }[focus.state];
  const left = focus.deadline ? Math.max(0, Math.ceil((focus.deadline - now) / 1000)) : undefined;
  if (!waitingOn || left === undefined) return { text: `${STATE_LABEL[focus.state]}…`, tone: focus.state === "RELEASING_STOCK" ? "comp" : "info", doing: true, id: `focus:${focus.state}` };
  return left > 0
    ? { text: `Waiting for ${waitingOn} · ${left}s left`, tone: "info", doing: true, id: `focus:${focus.state}:wait` }
    : { text: `Giving up on ${waitingOn}…`, tone: "fail", doing: true, id: `focus:${focus.state}:over` };
}
