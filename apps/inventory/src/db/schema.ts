import type { Item } from "@checkout/contracts";
import { inboxTable, outboxTable } from "@checkout/messaging";
import { sql } from "drizzle-orm";
import { check, integer, jsonb, snakeCase, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const inventorySchema = snakeCase.schema("inventory");

/** Inventory owns the catalog (name, price) and the stock levels. */
export const products = inventorySchema.table(
  "products",
  {
    sku: text().primaryKey(),
    name: text().notNull(),
    price: integer().notNull(),
    stock: integer().notNull(),
    updatedAt: timestamp({ withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [check("stock_not_negative", sql`${t.stock} >= 0`)],
);

export const reservationStatus = inventorySchema.enum("reservation_status", ["RESERVED", "RELEASED"]);

/** One reservation per order, so release knows what to put back. */
export const reservations = inventorySchema.table("reservations", {
  orderId: uuid().primaryKey(),
  items: jsonb().$type<Item[]>().notNull(),
  status: reservationStatus().notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const outbox = outboxTable(inventorySchema);
export const inbox = inboxTable(inventorySchema);
