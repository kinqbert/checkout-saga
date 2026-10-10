import * as z from "zod";
import { Envelope } from "../envelope";
import { ErrorPayload } from "../shared";

// COMMANDS
export const CapturePaymentCmd = Envelope.extend({
  type: z.literal("checkout.cmd.payment.capture"),
  payload: z.object({ amount: z.int().min(1) }),
});
export type CapturePaymentCmd = z.infer<typeof CapturePaymentCmd>;

// EVENTS
export const PaymentCapturedEvt = Envelope.extend({
  type: z.literal("checkout.evt.payment.captured"),
  payload: z.object({}),
});
export type PaymentCapturedEvt = z.infer<typeof PaymentCapturedEvt>;

export const PaymentFailedEvt = Envelope.extend({
  type: z.literal("checkout.evt.payment.failed"),
  payload: ErrorPayload,
});
export type PaymentFailedEvt = z.infer<typeof PaymentFailedEvt>;

// DISCRIMINATED UNIONS
export const PaymentCommand = z.discriminatedUnion("type", [CapturePaymentCmd]);
export const PaymentEvent = z.discriminatedUnion("type", [
  PaymentCapturedEvt,
  PaymentFailedEvt,
]);

export type PaymentCommand = z.infer<typeof PaymentCommand>;
export type PaymentEvent = z.infer<typeof PaymentEvent>;
