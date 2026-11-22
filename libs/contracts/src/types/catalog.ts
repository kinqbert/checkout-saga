import * as z from "zod";
import { BaseEnvelope } from "../envelope.js";

// events
// published by inventory (the catalog owner) whenever a product is created or
// its price/name changes. Consumers keep a local read model from it.
export const ProductUpsertedEvt = BaseEnvelope.extend({
  type: z.literal("catalog.evt.product.upserted"),
  payload: z.object({
    sku: z.string().min(1),
    name: z.string().min(1),
    price: z.int().min(0),
  }),
});
export type ProductUpsertedEvt = z.infer<typeof ProductUpsertedEvt>;
