import type { OrderLine } from "@checkout/contracts";
import { inboxTable, outboxTable } from "@checkout/messaging";
import {
  bigserial,
  index,
  integer,
  jsonb,
  snakeCase,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { SagaStates } from "../saga/saga.types.js";

const timefields = {
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};

export const ordersSchema = snakeCase.schema("orders");

export const orderStateEnum = ordersSchema.enum("order_state", SagaStates);

/** One row = one saga. The orchestrator's private memory. */
export const orders = ordersSchema.table("orders", {
  id: uuid().primaryKey(),
  state: orderStateEnum().notNull(),
  amount: integer().notNull(),
  /** Snapshot of what was bought, at the price it was bought for. */
  items: jsonb().$type<OrderLine[]>().notNull(),
  cancelReason: text(),
  /** Client-supplied key so a retried POST does not create a second order. */
  idempotencyKey: text().unique(),
  /** Trace that started the saga, so the UI can show it. */
  traceId: text(),
  ...timefields,
});

/** Audit log of saga state changes, shown as the order timeline. */
export const orderTransitions = ordersSchema.table(
  "order_transitions",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    fromState: orderStateEnum(),
    toState: orderStateEnum().notNull(),
    cause: text().notNull(),
    at: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index().on(t.orderId)],
);

/**
 * Local read model of the catalog, which inventory owns. Fed by
 * catalog.evt.product.upserted, so pricing an order needs no call to inventory.
 */
export const products = ordersSchema.table("products", {
  sku: text().primaryKey(),
  name: text().notNull(),
  price: integer().notNull(),
  /** occurredAt of the event that wrote this row; older events are ignored. */
  sourceUpdatedAt: timestamp({ withTimezone: true }).notNull(),
});

export const outbox = outboxTable(ordersSchema);
export const inbox = inboxTable(ordersSchema);
