import type { BaseEnvelope, Envelope } from "@checkout/contracts";
import { currentTraceHeaders, trace } from "@checkout/telemetry";
import { randomUUID } from "node:crypto";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core";
import type { InboxTable, OutboxInsert, OutboxTable } from "./tables.js";

export type Tx = PgAsyncDatabase<NodePgQueryResultHKT, any>;

interface TypedMessage {
  type: string;
  payload: unknown;
}

export function sagaEnvelope<M extends TypedMessage>(
  message: M,
  orderId: string,
  causationId?: string,
): M & Envelope {
  return {
    ...message,
    id: randomUUID(),
    orderId,
    occurredAt: new Date().toISOString(),
    ...(causationId ? { causationId } : {}),
  };
}

export function plainEnvelope<M extends TypedMessage>(message: M): M & BaseEnvelope {
  return { ...message, id: randomUUID(), occurredAt: new Date().toISOString() };
}

// builds an outbox row, capturing the active trace context for the consumer to continue.
export function outboxRow(envelope: BaseEnvelope, subject = envelope.type): OutboxInsert {
  return { id: envelope.id, subject, envelope, headers: currentTraceHeaders() };
}

export async function enqueue(tx: Tx, table: OutboxTable, rows: OutboxInsert[]): Promise<void> {
  if (rows.length > 0) await tx.insert(table).values(rows);
}

// records that `consumer` processed `messageId`; false means seen before, so skip side effects.
export async function claimMessage(
  tx: Tx,
  table: InboxTable,
  messageId: string,
  consumer: string,
): Promise<boolean> {
  const inserted = await tx
    .insert(table)
    .values({ messageId, consumer })
    .onConflictDoNothing()
    .returning({ id: table.messageId });
  if (inserted.length === 0) {
    trace.getActiveSpan()?.setAttribute("checkout.inbox.duplicate", true);
    trace.getActiveSpan()?.addEvent("duplicate ignored by the inbox");
  }
  return inserted.length > 0;
}
