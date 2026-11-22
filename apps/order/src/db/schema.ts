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
import { sql } from "drizzle-orm";
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

// one row = one saga.
export const orders = ordersSchema.table("orders", {
  id: uuid().primaryKey(),
  state: orderStateEnum().notNull(),
  amount: integer().notNull(),
  items: jsonb().$type<OrderLine[]>().notNull(),
  cancelReason: text(),
  idempotencyKey: text().unique(),
  traceId: text(),
  // when a waiting saga gives up; stored, so a deadline survives a restart.
  deadlineAt: timestamp({ withTimezone: true }),
  // trace context of the last step, so a timeout joins the saga's trace.
  traceHeaders: jsonb().$type<Record<string, string>>(),
  ...timefields,
}, (t) => [index().on(t.deadlineAt).where(sql`${t.deadlineAt} is not null`)]);

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

// local copy of inventory's catalog, so pricing an order needs no call to inventory.
export const products = ordersSchema.table("products", {
  sku: text().primaryKey(),
  name: text().notNull(),
  price: integer().notNull(),
  // occurredAt of the last event applied; older events are ignored.
  sourceUpdatedAt: timestamp({ withTimezone: true }).notNull(),
});

export const outbox = outboxTable(ordersSchema);
export const inbox = inboxTable(ordersSchema);
