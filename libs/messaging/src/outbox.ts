import type { BaseEnvelope, Envelope } from "@checkout/contracts";
import { currentTraceHeaders, trace } from "@checkout/telemetry";
import { randomUUID } from "node:crypto";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core";
import type { InboxTable, OutboxInsert, OutboxTable } from "./tables.js";

/** A drizzle database or transaction handle (node-postgres driver). */
export type Tx = PgAsyncDatabase<NodePgQueryResultHKT, any>;

interface TypedMessage {
  type: string;
  payload: unknown;
}

/** Wraps a `{type, payload}` message into a saga envelope. */
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

/** Wraps a message that is not tied to an order (e.g. catalog events). */
export function plainEnvelope<M extends TypedMessage>(message: M): M & BaseEnvelope {
  return { ...message, id: randomUUID(), occurredAt: new Date().toISOString() };
}

/**
 * Builds an outbox row. Call it inside the code path whose trace should
 * continue on the consumer side: the active trace context is captured here.
 */
export function outboxRow(envelope: BaseEnvelope, subject = envelope.type): OutboxInsert {
  return { id: envelope.id, subject, envelope, headers: currentTraceHeaders() };
}

export async function enqueue(tx: Tx, table: OutboxTable, rows: OutboxInsert[]): Promise<void> {
  if (rows.length > 0) await tx.insert(table).values(rows);
}

/**
 * Records that `consumer` processed `messageId`. Returns false when it already
 * did, in which case the caller should skip its side effects and just ack.
 */
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
    // Seen before: the caller skips its side effects. Say so in the trace.
    trace.getActiveSpan()?.setAttribute("checkout.inbox.duplicate", true);
    trace.getActiveSpan()?.addEvent("duplicate ignored by the inbox");
  }
  return inserted.length > 0;
}
