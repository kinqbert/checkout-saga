import { Item } from "@checkout/contracts";
import {
  CheckoutSaga,
  OutgoingMessage,
  SagaEvent,
  TransitionResult,
} from "./saga.types";
import {
  handleSagaAwaitingPayment,
  handleSagaAwaitingStock,
  handleSagaReleasingStock,
} from "./saga.handlers";

export function startSaga(
  orderId: string,
  items: Item[],
  amount: number,
): TransitionResult {
  const saga: CheckoutSaga = {
    orderId,
    state: "AWAITING_STOCK",
    items,
    amount,
  };

  const message: OutgoingMessage = {
    type: "checkout.cmd.inventory.reserve",
    payload: { items },
  };

  const result: TransitionResult = {
    saga,
    messages: [message],
  };

  return result;
}

export function transition(
  saga: CheckoutSaga,
  event: SagaEvent,
): TransitionResult {
  switch (saga.state) {
    case "AWAITING_STOCK":
      return handleSagaAwaitingStock(saga, event);
    case "AWAITING_PAYMENT":
      return handleSagaAwaitingPayment(saga, event);
    case "RELEASING_STOCK":
      return handleSagaReleasingStock(saga, event);
    case "CANCELLED":
    case "CONFIRMED":
      return { saga, messages: [] };
    default:
      throw new Error(`A ${saga.state} state is not handled`);
  }
}
