import * as z from "zod";
import { Envelope } from "../envelope.js";
import { ErrorPayload } from "../shared.js";

// COMMANDS
export const CapturePaymentCmd = Envelope.extend({
  type: z.literal("checkout.cmd.payment.capture"),
  payload: z.object({
    amount: z.int().min(1),
    /** When the order stops waiting for an answer. Past it, payment refuses to charge. */
    deadline: z.iso.datetime().optional(),
  }),
});
export type CapturePaymentCmd = z.infer<typeof CapturePaymentCmd>;

/** Compensation for a charge that landed after the order had given up on it. */
export const RefundPaymentCmd = Envelope.extend({
  type: z.literal("checkout.cmd.payment.refund"),
  payload: z.object({}),
});
export type RefundPaymentCmd = z.infer<typeof RefundPaymentCmd>;

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

export const PaymentRefundedEvt = Envelope.extend({
  type: z.literal("checkout.evt.payment.refunded"),
  payload: z.object({}),
});
export type PaymentRefundedEvt = z.infer<typeof PaymentRefundedEvt>;

// DISCRIMINATED UNIONS
export const PaymentCommand = z.discriminatedUnion("type", [CapturePaymentCmd, RefundPaymentCmd]);
export const PaymentEvent = z.discriminatedUnion("type", [
  PaymentCapturedEvt,
  PaymentFailedEvt,
  PaymentRefundedEvt,
]);

export type PaymentCommand = z.infer<typeof PaymentCommand>;
export type PaymentEvent = z.infer<typeof PaymentEvent>;
