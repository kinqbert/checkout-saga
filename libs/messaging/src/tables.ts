import type { BaseEnvelope } from "@checkout/contracts";
import { isNull } from "drizzle-orm";
import {
  bigserial,
  index,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uuid,
  type PgSchema,
} from "drizzle-orm/pg-core";

/**
 * Transactional outbox: a service writes its state change and the messages it
 * wants to send in the same transaction; the relay publishes them afterwards.
 * `headers` keeps the W3C trace context of the writer so the trace continues
 * across the asynchronous hop.
 */
export function outboxTable(schema: PgSchema<string>) {
  return schema.table(
    "outbox",
    {
      id: uuid("id").primaryKey(),
      seq: bigserial("seq", { mode: "number" }).notNull(),
      subject: text("subject").notNull(),
      envelope: jsonb("envelope").$type<BaseEnvelope>().notNull(),
      headers: jsonb("headers").$type<Record<string, string>>().notNull().default({}),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
      publishedAt: timestamp("published_at", { withTimezone: true }),
    },
    (t) => [index("outbox_unpublished_idx").on(t.seq).where(isNull(t.publishedAt))],
  );
}

/**
 * Inbox: one row per (message, consumer) that was processed. Inserting the
 * row in the same transaction as the side effects makes redelivery harmless.
 */
export function inboxTable(schema: PgSchema<string>) {
  return schema.table(
    "inbox",
    {
      messageId: uuid("message_id").notNull(),
      consumer: text("consumer").notNull(),
      processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => [primaryKey({ columns: [t.messageId, t.consumer] })],
  );
}

export type OutboxTable = ReturnType<typeof outboxTable>;
export type InboxTable = ReturnType<typeof inboxTable>;
export type OutboxInsert = OutboxTable["$inferInsert"];
