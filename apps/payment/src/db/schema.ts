import { inboxTable, outboxTable } from "@checkout/messaging";
import { integer, snakeCase, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const paymentsSchema = snakeCase.schema("payments");

export const paymentStatus = paymentsSchema.enum("payment_status", ["CAPTURED", "FAILED", "REFUNDED"]);

/** At most one payment attempt per order (unique order_id). */
export const payments = paymentsSchema.table("payments", {
  id: uuid().primaryKey(),
  orderId: uuid().notNull().unique(),
  amount: integer().notNull(),
  status: paymentStatus().notNull(),
  failureReason: text(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const outbox = outboxTable(paymentsSchema);
export const inbox = inboxTable(paymentsSchema);
