import { Item } from "@checkout/contracts";
import {
  CheckoutSaga,
  OutgoingMessage,
  SagaContext,
  SagaEvent,
  TransitionResult,
} from "./saga.types.js";
import {
  handleLateReply,
  handleSagaAwaitingPayment,
  handleSagaAwaitingStock,
  handleSagaReleasingStock,
} from "./saga.handlers.js";

export function startSaga(
  orderId: string,
  items: Item[],
  amount: number,
  ctx: SagaContext,
): TransitionResult {
  const saga: CheckoutSaga = {
    orderId,
    state: "AWAITING_STOCK",
    items,
    amount,
  };

  const message: OutgoingMessage = {
    type: "checkout.cmd.inventory.reserve",
    payload: { items, deadline: ctx.deadline },
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
  ctx: SagaContext,
): TransitionResult {
  switch (saga.state) {
    case "AWAITING_STOCK":
      return handleSagaAwaitingStock(saga, event, ctx);
    case "AWAITING_PAYMENT":
      return handleSagaAwaitingPayment(saga, event);
    case "RELEASING_STOCK":
      return handleSagaReleasingStock(saga, event);
    case "CANCELLED":
      return handleLateReply(saga, event);
    case "CONFIRMED":
      return { saga, messages: [] };
    default:
      throw new Error(`A ${saga.state} state is not handled`);
  }
}
