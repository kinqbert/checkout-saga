import { InventoryEvent, PaymentEvent, TraceAttr } from "@checkout/contracts";
import {
  claimMessage,
  enqueue,
  outboxRow,
  OutboxRelay,
  PoisonMessageError,
  sagaEnvelope,
  startConsumer,
  Streams,
  LabFaults,
  type Bus,
  type Database,
  type Tx,
} from "@checkout/messaging";
import { currentTraceHeaders, trace } from "@checkout/telemetry";
import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { eq } from "drizzle-orm";
import * as z from "zod";
import { inbox, orders, orderTransitions, outbox } from "../db/schema.js";
import { BUS, DB } from "../infra.js";
import { transition } from "./saga.orchestrator.js";
import { isWaiting, type CheckoutSaga, type SagaEvent } from "./saga.types.js";

const SagaEventSchema = z.union([InventoryEvent, PaymentEvent]);
const CONSUMER = "order-saga";

/** How long the saga waits for inventory or payment to answer before giving up. */
export const STEP_TIMEOUT_MS = Number(process.env.SAGA_STEP_TIMEOUT_MS ?? 20_000);

type OrderRow = typeof orders.$inferSelect;

/**
 * The I/O shell around the pure state machine: for every inventory/payment
 * event it loads the saga, calls transition(), and stores the new state plus
 * the next commands in one transaction (inbox row included, so a redelivered
 * event is a no-op). SagaTimeouts feeds it timeouts the same way.
 */
@Injectable()
export class SagaRunner implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly log = new Logger(SagaRunner.name);
  private consumer?: { stop(): Promise<void> };

  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(BUS) private readonly bus: Bus,
    private readonly relay: OutboxRelay,
    private readonly faults: LabFaults,
  ) {}

  async onApplicationBootstrap() {
    this.consumer = await startConsumer({
      bus: this.bus,
      stream: Streams.checkout.name,
      durable: CONSUMER,
      filterSubjects: ["checkout.evt.inventory.>", "checkout.evt.payment.>"],
      handle: (data) => this.handle(data),
      faults: this.faults,
      log: (m, e) => this.log.warn(`${m} ${e ?? ""}`),
    });
  }

  async beforeApplicationShutdown() {
    await this.consumer?.stop();
  }

  async handle(data: unknown): Promise<void> {
    const parsed = SagaEventSchema.safeParse(data);
    if (!parsed.success) throw new PoisonMessageError(parsed.error.message);
    const event: SagaEvent = parsed.data;

    const wrote = await this.database.db.transaction(async (tx) => {
      if (!(await claimMessage(tx, inbox, event.id, CONSUMER))) return false;

      const [row] = await tx.select().from(orders).where(eq(orders.id, event.orderId)).for("update");
      if (!row) throw new PoisonMessageError(`no order ${event.orderId}`);
      return this.apply(tx, row, event, event.id);
    });

    if (wrote) this.relay.nudge();
  }

  /**
   * Runs one event through the state machine for a locked order row and
   * stores the outcome: new state, its deadline, the timeline entry and the
   * next messages. A late reply can produce messages without a new state
   * (a compensation); those are stored too. Returns whether anything was written.
   */
  async apply(tx: Tx, row: OrderRow, event: SagaEvent, causationId?: string): Promise<boolean> {
    const saga: CheckoutSaga = {
      orderId: row.id,
      state: row.state,
      amount: row.amount,
      items: row.items.map(({ sku, quantity }) => ({ sku, quantity })),
      ...(row.cancelReason ? { cancelReason: row.cancelReason } : {}),
    };
    const deadline = new Date(Date.now() + STEP_TIMEOUT_MS);
    const result = transition(saga, event, { deadline: deadline.toISOString() });
    const moved = result.saga.state !== saga.state;

    // A late success being undone, or a refund confirming, doesn't move the
    // saga but belongs on its timeline.
    const noted = !moved && (result.messages.length > 0 || event.type === "checkout.evt.payment.refunded");
    if (!moved && !noted) {
      this.log.warn(`ignored ${event.type} for order ${row.id} in state ${row.state}`);
      return false;
    }

    const span = trace.getActiveSpan();
    if (moved) {
      span?.setAttributes({ [TraceAttr.sagaFrom]: saga.state, [TraceAttr.sagaTo]: result.saga.state });
      await tx
        .update(orders)
        .set({
          state: result.saga.state,
          cancelReason: result.saga.cancelReason ?? null,
          deadlineAt: isWaiting(result.saga.state) ? deadline : null,
          traceHeaders: currentTraceHeaders(),
        })
        .where(eq(orders.id, row.id));
      await tx.insert(orderTransitions).values({
        orderId: row.id,
        fromState: saga.state,
        toState: result.saga.state,
        cause: event.type,
      });
    } else {
      if (result.messages.length > 0)
        span?.addEvent(`late ${event.type} after the saga stopped waiting: compensating`);
      // Same state on both ends: the UI shows it as a note, not a step.
      await tx.insert(orderTransitions).values({
        orderId: row.id,
        fromState: saga.state,
        toState: saga.state,
        cause: event.type,
      });
    }
    await enqueue(
      tx,
      outbox,
      result.messages.map((m) => outboxRow(sagaEnvelope(m, row.id, causationId))),
    );
    return true;
  }
}
