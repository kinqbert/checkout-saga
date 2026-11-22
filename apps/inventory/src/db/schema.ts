import type { Item } from "@checkout/contracts";
import { inboxTable, outboxTable } from "@checkout/messaging";
import { sql } from "drizzle-orm";
import { boolean, check, integer, jsonb, snakeCase, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const inventorySchema = snakeCase.schema("inventory");

// Inventory owns the catalog (name, price) and the stock levels.
export const products = inventorySchema.table(
  "products",
  {
    sku: text().primaryKey(),
    name: text().notNull(),
    price: integer().notNull(),
    stock: integer().notNull(),
    // limited products run out for real; regular ones are replenished by the supplier.
    limited: boolean().notNull().default(false),
    updatedAt: timestamp({ withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [check("stock_not_negative", sql`${t.stock} >= 0`)],
);

export const reservationStatus = inventorySchema.enum("reservation_status", ["RESERVED", "RELEASED"]);

// one reservation per order, so release knows what to put back.
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
