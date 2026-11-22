import type { CheckoutSaga, OutgoingMessage, SagaContext, SagaEvent, SagaState, TransitionResult } from "./saga.types.js";

export const STOCK_TIMEOUT_REASON = "inventory did not answer in time";
export const PAYMENT_TIMEOUT_REASON = "payment did not answer in time";

const stay = (saga: CheckoutSaga): TransitionResult => ({ saga, messages: [] });
const move = (saga: CheckoutSaga, state: SagaState, ...messages: OutgoingMessage[]): TransitionResult => ({
  saga: { ...saga, state },
  messages,
});
const cancel = (saga: CheckoutSaga, reason: string): TransitionResult => ({
  saga: { ...saga, state: "CANCELLED", cancelReason: reason },
  messages: [{ type: "checkout.evt.order.cancelled", payload: { reason } }],
});

const releaseStock: OutgoingMessage = { type: "checkout.cmd.inventory.release", payload: {} };
// release the stock first; the saga cancels with this reason once it's back.
const compensate = (saga: CheckoutSaga, reason: string): TransitionResult => ({
  saga: { ...saga, state: "RELEASING_STOCK", cancelReason: reason },
  messages: [releaseStock],
});

export function handleSagaAwaitingStock(saga: CheckoutSaga, event: SagaEvent, ctx: SagaContext): TransitionResult {
  switch (event.type) {
    case "checkout.evt.inventory.reserved":
      return move(saga, "AWAITING_PAYMENT", { type: "checkout.cmd.payment.capture", payload: { amount: saga.amount, deadline: ctx.deadline } });
    case "checkout.evt.inventory.rejected":
      return cancel(saga, event.payload.reason);
    // Inventory refuses to reserve past the deadline; one that raced it is released late.
    case "saga.timeout":
      return cancel(saga, STOCK_TIMEOUT_REASON);
    default:
      return stay(saga);
  }
}

// Payment is the pivot: once captured, the order is done.
export function handleSagaAwaitingPayment(saga: CheckoutSaga, event: SagaEvent): TransitionResult {
  switch (event.type) {
    case "checkout.evt.payment.captured":
      return move(saga, "CONFIRMED", { type: "checkout.evt.order.confirmed", payload: {} });
    case "checkout.evt.payment.failed":
      return compensate(saga, event.payload.reason);
    // a charge that lands after this is refunded when its late reply arrives.
    case "saga.timeout":
      return compensate(saga, PAYMENT_TIMEOUT_REASON);
    default:
      return stay(saga);
  }
}

export function handleSagaReleasingStock(saga: CheckoutSaga, event: SagaEvent): TransitionResult {
  if (event.type === "checkout.evt.inventory.released") return cancel(saga, saga.cancelReason ?? "unknown");
  return handleLateReply(saga, event);
}

// a step that succeeded after the saga timed out: the state stays, the success is undone.
export function handleLateReply(saga: CheckoutSaga, event: SagaEvent): TransitionResult {
  switch (event.type) {
    case "checkout.evt.inventory.reserved":
      return { saga, messages: [releaseStock] };
    case "checkout.evt.payment.captured":
      return { saga, messages: [{ type: "checkout.cmd.payment.refund", payload: {} }] };
    default:
      return stay(saga);
  }
}
