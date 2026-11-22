import { CheckoutSaga, SagaContext, SagaEvent, TransitionResult } from "./saga.types.js";

export const STOCK_TIMEOUT_REASON = "inventory did not answer in time";
export const PAYMENT_TIMEOUT_REASON = "payment did not answer in time";

export function handleSagaAwaitingStock(
  saga: CheckoutSaga,
  event: SagaEvent,
  ctx: SagaContext,
): TransitionResult {
  switch (event.type) {
    case "checkout.evt.inventory.reserved": {
      return {
        saga: { ...saga, state: "AWAITING_PAYMENT" },
        messages: [
          {
            type: "checkout.cmd.payment.capture",
            payload: { amount: saga.amount, deadline: ctx.deadline },
          },
        ],
      };
    }
    case "checkout.evt.inventory.rejected": {
      return {
        saga: {
          ...saga,
          cancelReason: event.payload.reason,
          state: "CANCELLED",
        },
        messages: [
          {
            type: "checkout.evt.order.cancelled",
            payload: {
              reason: event.payload.reason,
            },
          },
        ],
      };
    }
    // Inventory never answered. Its reserve command carries the same deadline,
    // so it won't reserve after this; a reservation that raced the deadline is
    // released when its late reply arrives (see handleLateReply).
    case "saga.timeout": {
      return {
        saga: { ...saga, cancelReason: STOCK_TIMEOUT_REASON, state: "CANCELLED" },
        messages: [{ type: "checkout.evt.order.cancelled", payload: { reason: STOCK_TIMEOUT_REASON } }],
      };
    }
    default: {
      return {
        saga,
        messages: [],
      };
    }
  }
}

export function handleSagaAwaitingPayment(
  saga: CheckoutSaga,
  event: SagaEvent,
): TransitionResult {
  switch (event.type) {
    case "checkout.evt.payment.captured": {
      return {
        saga: { ...saga, state: "CONFIRMED" },
        messages: [
          {
            type: "checkout.evt.order.confirmed",
            payload: {},
          },
        ],
      };
    }
    case "checkout.evt.payment.failed": {
      return {
        saga: {
          ...saga,
          cancelReason: event.payload.reason,
          state: "RELEASING_STOCK",
        },
        messages: [
          {
            type: "checkout.cmd.inventory.release",
            payload: {},
          },
        ],
      };
    }
    // Payment never answered: give the stock back and cancel. A charge that
    // lands after this is refunded when its late reply arrives.
    case "saga.timeout": {
      return {
        saga: { ...saga, cancelReason: PAYMENT_TIMEOUT_REASON, state: "RELEASING_STOCK" },
        messages: [{ type: "checkout.cmd.inventory.release", payload: {} }],
      };
    }
    default: {
      return {
        saga,
        messages: [],
      };
    }
  }
}

export function handleSagaReleasingStock(
  saga: CheckoutSaga,
  event: SagaEvent,
): TransitionResult {
  switch (event.type) {
    case "checkout.evt.inventory.released": {
      return {
        saga: {
          ...saga,
          cancelReason: saga.cancelReason ?? "unknown",
          state: "CANCELLED",
        },
        messages: [
          {
            type: "checkout.evt.order.cancelled",
            payload: {
              reason: saga.cancelReason ?? "unknown",
            },
          },
        ],
      };
    }

    default: {
      return handleLateReply(saga, event);
    }
  }
}

/**
 * A step succeeded after the saga had stopped waiting for it (it timed out).
 * The state stays as it is; the late success is compensated instead: stock
 * reserved too late is released, a card charged too late is refunded.
 */
export function handleLateReply(saga: CheckoutSaga, event: SagaEvent): TransitionResult {
  switch (event.type) {
    case "checkout.evt.inventory.reserved":
      return { saga, messages: [{ type: "checkout.cmd.inventory.release", payload: {} }] };
    case "checkout.evt.payment.captured":
      return { saga, messages: [{ type: "checkout.cmd.payment.refund", payload: {} }] };
    default:
      return { saga, messages: [] };
  }
}
