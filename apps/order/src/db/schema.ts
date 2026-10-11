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
import { SagaStates } from "../saga/saga.types";
import { Envelope, Item } from "@checkout/contracts";
import { isNull } from "drizzle-orm";

const timefields = {
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};

export const ordersSchema = snakeCase.schema("orders");

export const orderStateEnum = ordersSchema.enum("order_state", SagaStates);

export const orders = ordersSchema.table("orders", {
  id: uuid().primaryKey(),
  state: orderStateEnum().notNull(),
  amount: integer().notNull(),
  items: jsonb().$type<Item[]>().notNull(),
  cancelReason: text(),
  ...timefields,
});

export const outbox = ordersSchema.table(
  "outbox",
  {
    id: uuid().primaryKey(),
    seq: bigserial({ mode: "number" }),
    subject: text().notNull(),
    envelope: jsonb().$type<Envelope>().notNull(),
    publishedAt: timestamp({ withTimezone: true }),
  },
  (table) => [index().on(table.seq).where(isNull(table.publishedAt))],
);
