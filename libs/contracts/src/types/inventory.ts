import * as z from "zod";
import { Envelope } from "../envelope";
import { ErrorPayload } from "../shared";

// GENERAL
export const Item = z.object({
  sku: z.string().min(1),
  quantity: z.int().min(1),
});
export type Item = z.infer<typeof Item>;

// COMMAND SCHEMAS
export const ReserveStockCmd = Envelope.extend({
  type: z.literal("checkout.cmd.inventory.reserve"),
  payload: z.object({ items: z.array(Item).min(1) }),
});
export type ReserveStockCmd = z.infer<typeof ReserveStockCmd>;

export const ReleaseStockCmd = Envelope.extend({
  type: z.literal("checkout.cmd.inventory.release"),
  payload: z.object({}),
});
export type ReleaseStockCmd = z.infer<typeof ReleaseStockCmd>;

// EVENT SCHEMAS
export const StockReservedEvt = Envelope.extend({
  type: z.literal("checkout.evt.inventory.reserved"),
  payload: z.object({}),
});
export type StockReservedEvt = z.infer<typeof StockReservedEvt>;

export const StockReleasedEvt = Envelope.extend({
  type: z.literal("checkout.evt.inventory.released"),
  payload: z.object({}),
});
export type StockReleasedEvt = z.infer<typeof StockReleasedEvt>;

export const StockRejectedEvt = Envelope.extend({
  type: z.literal("checkout.evt.inventory.rejected"),
  payload: ErrorPayload.extend({ skus: z.array(z.string().min(1)) }),
});
export type StockRejectedEvt = z.infer<typeof StockRejectedEvt>;

// DISCRIMINATED UNIONS
export const InventoryCommand = z.discriminatedUnion("type", [
  ReserveStockCmd,
  ReleaseStockCmd,
]);
export const InventoryEvent = z.discriminatedUnion("type", [
  StockReservedEvt,
  StockReleasedEvt,
  StockRejectedEvt,
]);

export type InventoryCommand = z.infer<typeof InventoryCommand>;
export type InventoryEvent = z.infer<typeof InventoryEvent>;
