import * as z from "zod";

export const Envelope = z.object({
  id: z.uuid(),
  type: z.string(),
  orderId: z.uuid(),
  causationId: z.uuid().optional(),
  occurredAt: z.iso.datetime(),
  payload: z.unknown(),
});

export type Envelope = z.infer<typeof Envelope>;
