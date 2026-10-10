import * as z from "zod";
import { Envelope } from "../envelope";
import { ErrorPayload } from "../shared";

// COMMANDS

// EVENTS
export const OrderConfirmedEvt = Envelope.extend({
  type: z.literal("checkout.evt.order.confirmed"),
  payload: z.object({}),
});
export type OrderConfirmedEvt = z.infer<typeof OrderConfirmedEvt>;

export const OrderCancelledEvt = Envelope.extend({
  type: z.literal("checkout.evt.order.cancelled"),
  payload: ErrorPayload,
});
export type OrderCancelledEvt = z.infer<typeof OrderCancelledEvt>;

// DISCRIMINATED UNIONS
export const OrderEvent = z.discriminatedUnion("type", [
  OrderConfirmedEvt,
  OrderCancelledEvt,
]);
export type OrderEvent = z.infer<typeof OrderEvent>;
