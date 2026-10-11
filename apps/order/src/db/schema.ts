import {
  integer,
  jsonb,
  pgSchema,
  snakeCase,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { SagaStates } from "../saga/saga.types";
import { Item } from "@checkout/contracts";

const timefields = {
  createdAt: timestamp()
    .defaultNow()
    .$onUpdate(() => new Date()),
  updatedAt: timestamp()
    .defaultNow()
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
