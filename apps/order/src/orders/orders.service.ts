import type { Item, OrderLine, OrderView } from "@checkout/contracts";
import {
  enqueue,
  outboxRow,
  OutboxRelay,
  sagaEnvelope,
  type Database,
} from "@checkout/messaging";
import { currentTraceHeaders, currentTraceId, slowModeHold, withSpan } from "@checkout/telemetry";
import { Inject, Injectable } from "@nestjs/common";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { orders, orderTransitions, outbox, products } from "../db/schema.js";
import { DB } from "../infra.js";
import { startSaga } from "../saga/saga.orchestrator.js";
import { STEP_TIMEOUT_MS } from "../saga/saga.runner.js";

export class UnknownProductsError extends Error {
  constructor(readonly skus: string[]) {
    super(`unknown products: ${skus.join(", ")}`);
  }
}

type OrderRow = typeof orders.$inferSelect;

export function toView(row: OrderRow): OrderView {
  return {
    id: row.id,
    state: row.state,
    amount: row.amount,
    lines: row.items,
    cancelReason: row.cancelReason,
    traceId: row.traceId,
    deadlineAt: row.deadlineAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Same sku twice in one request becomes one line. */
function mergeItems(items: Item[]): Item[] {
  const bySku = new Map<string, number>();
  for (const { sku, quantity } of items) bySku.set(sku, (bySku.get(sku) ?? 0) + quantity);
  return [...bySku].map(([sku, quantity]) => ({ sku, quantity }));
}

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DB) private readonly database: Database,
    private readonly relay: OutboxRelay,
  ) {}

  private get db() {
    return this.database.db;
  }

  /**
   * Prices the order from the local catalog replica, then writes the order
   * row, its first transition and the saga's first command in ONE transaction.
   * Nothing is published here; the outbox relay does that after commit.
   */
  async placeOrder(
    requested: Item[],
    idempotencyKey?: string,
  ): Promise<{ order: OrderView; created: boolean }> {
    if (idempotencyKey) {
      const existing = await this.findByKey(idempotencyKey);
      if (existing) return { order: existing, created: false };
    }

    // Slow mode: the HTTP hop from the gateway takes a visible second too,
    // so the first command is published after it, not alongside it.
    await slowModeHold();

    const items = mergeItems(requested);
    const created = await withSpan("order.place", {}, (span) =>
      this.db.transaction(async (tx) => {
        const catalog = await tx
          .select()
          .from(products)
          .where(
            inArray(
              products.sku,
              items.map((i) => i.sku),
            ),
          );
        const priceOf = new Map(catalog.map((p) => [p.sku, p]));
        const unknown = items.filter((i) => !priceOf.has(i.sku)).map((i) => i.sku);
        if (unknown.length > 0) throw new UnknownProductsError(unknown);

        const lines: OrderLine[] = items.map((i) => {
          const p = priceOf.get(i.sku)!;
          return { ...i, name: p.name, unitPrice: p.price };
        });
        const amount = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

        const orderId = randomUUID();
        span.setAttribute("checkout.order_id", orderId);
        const deadline = new Date(Date.now() + STEP_TIMEOUT_MS);
        const { saga, messages } = startSaga(orderId, items, amount, { deadline: deadline.toISOString() });

        const [row] = await tx
          .insert(orders)
          .values({
            id: orderId,
            state: saga.state,
            amount,
            items: lines,
            idempotencyKey: idempotencyKey ?? null,
            traceId: currentTraceId() ?? null,
            deadlineAt: deadline,
            traceHeaders: currentTraceHeaders(),
          })
          .onConflictDoNothing({ target: orders.idempotencyKey })
          .returning();
        // A concurrent request with the same key won the race.
        if (!row) return undefined;

        await tx
          .insert(orderTransitions)
          .values({ orderId, fromState: null, toState: saga.state, cause: "order.placed" });
        await enqueue(
          tx,
          outbox,
          messages.map((m) => outboxRow(sagaEnvelope(m, orderId))),
        );
        return toView(row);
      }),
    );

    if (!created) {
      const existing = await this.findByKey(idempotencyKey!);
      return { order: existing!, created: false };
    }
    this.relay.nudge();
    return { order: created, created: true };
  }

  async list(limit: number): Promise<OrderView[]> {
    const rows = await this.db.select().from(orders).orderBy(desc(orders.createdAt)).limit(limit);
    return rows.map(toView);
  }

  async get(id: string): Promise<OrderView | undefined> {
    const [row] = await this.db.select().from(orders).where(eq(orders.id, id));
    if (!row) return undefined;
    const transitions = await this.db
      .select()
      .from(orderTransitions)
      .where(eq(orderTransitions.orderId, id))
      .orderBy(asc(orderTransitions.id));
    return {
      ...toView(row),
      transitions: transitions.map((t) => ({
        from: t.fromState,
        to: t.toState,
        cause: t.cause,
        at: t.at.toISOString(),
      })),
    };
  }

  private async findByKey(key: string): Promise<OrderView | undefined> {
    const [row] = await this.db.select().from(orders).where(eq(orders.idempotencyKey, key));
    return row ? toView(row) : undefined;
  }
}
