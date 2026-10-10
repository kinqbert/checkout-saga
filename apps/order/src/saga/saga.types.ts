import {
  CapturePaymentCmd,
  InventoryEvent,
  Item,
  OrderCancelledEvt,
  OrderConfirmedEvt,
  PaymentEvent,
  ReleaseStockCmd,
  ReserveStockCmd,
} from "@checkout/contracts";

export type SagaState =
  | "AWAITING_STOCK"
  | "AWAITING_PAYMENT"
  | "RELEASING_STOCK"
  | "CONFIRMED"
  | "CANCELLED";

type SentMessage =
  | ReserveStockCmd
  | CapturePaymentCmd
  | ReleaseStockCmd
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

export type SagaEvent = InventoryEvent | PaymentEvent;
