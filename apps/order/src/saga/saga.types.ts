import {
  CapturePaymentCmd,
  InventoryEvent,
  Item,
  OrderCancelledEvt,
  OrderConfirmedEvt,
  PaymentEvent,
  RefundPaymentCmd,
  ReleaseStockCmd,
  ReserveStockCmd,
} from "@checkout/contracts";

export const SagaStates = [
  "AWAITING_STOCK",
  "AWAITING_PAYMENT",
  "RELEASING_STOCK",
  "CONFIRMED",
  "CANCELLED",
] as const;

export type SagaState = (typeof SagaStates)[number];

type SentMessage =
  | ReserveStockCmd
  | CapturePaymentCmd
  | ReleaseStockCmd
  | RefundPaymentCmd
  | OrderConfirmedEvt
  | OrderCancelledEvt;

export interface CheckoutSaga {
  orderId: string;
  state: SagaState;
  items: Item[];
  amount: number;
  cancelReason?: string;
}

type TypeAndPayload<T> = T extends { type: infer K; payload: infer P }
  ? { type: K; payload: P }
  : never;

export type OutgoingMessage = TypeAndPayload<SentMessage>;

export interface TransitionResult {
  saga: CheckoutSaga;
  messages: OutgoingMessage[];
}

/**
 * Raised by the order service itself (not a message) when a step's deadline
 * passes without an answer.
 */
export interface SagaTimeout {
  type: "saga.timeout";
}

export type SagaEvent = InventoryEvent | PaymentEvent | SagaTimeout;

/** Input the pure state machine can't make up itself. */
export interface SagaContext {
  /** ISO time the next step must answer by; sent with the command. */
  deadline: string;
}

/** States that wait on another service, and so carry a deadline. */
export const WAITING_STATES = ["AWAITING_STOCK", "AWAITING_PAYMENT"] as const satisfies readonly SagaState[];
export const isWaiting = (s: SagaState) => (WAITING_STATES as readonly SagaState[]).includes(s);
