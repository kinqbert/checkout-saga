import * as z from "zod";

// fields every message on the bus carries.
export const BaseEnvelope = z.object({
  id: z.uuid(),
  type: z.string(),
  causationId: z.uuid().optional(),
  occurredAt: z.iso.datetime(),
  payload: z.unknown(),
});
export type BaseEnvelope = z.infer<typeof BaseEnvelope>;

// a message that belongs to one checkout saga.
export const Envelope = BaseEnvelope.extend({
  orderId: z.uuid(),
});
export type Envelope = z.infer<typeof Envelope>;
