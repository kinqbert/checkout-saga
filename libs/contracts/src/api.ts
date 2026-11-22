import * as z from "zod";
import { Item } from "./types/inventory.js";

/** HTTP shapes shared by gateway, services and the web UI. Money is integer cents. */

export const PlaceOrderRequest = z.object({
  items: z.array(Item).min(1).max(20),
});
export type PlaceOrderRequest = z.infer<typeof PlaceOrderRequest>;

export const OrderLine = Item.extend({
  name: z.string(),
  unitPrice: z.int().min(0),
});
export type OrderLine = z.infer<typeof OrderLine>;

export interface OrderTransitionView {
  from: string | null;
  to: string;
  cause: string;
  at: string;
}

export interface OrderView {
  id: string;
  state: string;
  amount: number;
  lines: OrderLine[];
  cancelReason: string | null;
  traceId: string | null;
  /** While the saga waits on another service: when it gives up (ISO), else null. */
  deadlineAt: string | null;
  createdAt: string;
  updatedAt: string;
  transitions?: OrderTransitionView[];
}

export interface ProductView {
  sku: string;
  name: string;
  price: number;
  stock: number;
}

export interface NotificationView {
  id: string;
  orderId: string;
  kind: string;
  message: string;
  createdAt: string;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
