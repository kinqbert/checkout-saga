import { CheckoutSaga, SagaEvent, TransitionResult } from "./saga.types";

export function handleSagaAwaitingStock(
  saga: CheckoutSaga,
  event: SagaEvent,
): TransitionResult {
  switch (event.type) {
    case "checkout.evt.inventory.reserved": {
      return {
        saga: { ...saga, state: "AWAITING_PAYMENT" },
        messages: [
          {
            type: "checkout.cmd.payment.capture",
            payload: { amount: saga.amount },
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
      return {
        saga,
        messages: [],
      };
    }
  }
}
