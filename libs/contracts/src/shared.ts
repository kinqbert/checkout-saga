import * as z from "zod";

export const ErrorPayload = z.object({
  reason: z.string().min(1),
});
export type ErrorPayload = z.infer<typeof ErrorPayload>;
