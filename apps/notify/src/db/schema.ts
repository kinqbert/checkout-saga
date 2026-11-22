import { inboxTable } from "@checkout/messaging";
import { snakeCase, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const notifySchema = snakeCase.schema("notify");

/** Stand-in for sent e-mails. */
export const notifications = notifySchema.table("notifications", {
  id: uuid().primaryKey(),
  orderId: uuid().notNull(),
  kind: text().notNull(),
  message: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const inbox = inboxTable(notifySchema);
