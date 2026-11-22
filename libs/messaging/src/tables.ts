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

// transactional outbox: messages written with the state change, published later by the relay.
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

// inbox: one row per processed (message, consumer), written with the side effects.
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
