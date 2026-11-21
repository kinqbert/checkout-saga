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
  type Bus,
  type Database,
} from "@checkout/messaging";
import { trace } from "@checkout/telemetry";
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
import type { CheckoutSaga, SagaEvent } from "./saga.types.js";

const SagaEventSchema = z.union([InventoryEvent, PaymentEvent]);
const CONSUMER = "order-saga";

/**
 * The I/O shell around the pure state machine: for every inventory/payment
 * event it loads the saga, calls transition(), and stores the new state plus
 * the next commands in one transaction (inbox row included, so a redelivered
 * event is a no-op).
 */
@Injectable()
export class SagaRunner implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly log = new Logger(SagaRunner.name);
  private consumer?: { stop(): Promise<void> };

  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(BUS) private readonly bus: Bus,
    private readonly relay: OutboxRelay,
  ) {}

  async onApplicationBootstrap() {
    this.consumer = await startConsumer({
      bus: this.bus,
      stream: Streams.checkout.name,
      durable: CONSUMER,
      filterSubjects: ["checkout.evt.inventory.>", "checkout.evt.payment.>"],
      handle: (data) => this.handle(data),
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

      const saga: CheckoutSaga = {
        orderId: row.id,
        state: row.state,
        amount: row.amount,
        items: row.items.map(({ sku, quantity }) => ({ sku, quantity })),
        ...(row.cancelReason ? { cancelReason: row.cancelReason } : {}),
      };
      const result = transition(saga, event);

      if (result.saga.state === saga.state) {
        this.log.warn(`ignored ${event.type} for order ${row.id} in state ${row.state}`);
        return false;
      }

      trace.getActiveSpan()?.setAttributes({
        [TraceAttr.sagaFrom]: saga.state,
        [TraceAttr.sagaTo]: result.saga.state,
      });
      await tx
        .update(orders)
        .set({ state: result.saga.state, cancelReason: result.saga.cancelReason ?? null })
        .where(eq(orders.id, row.id));
      await tx.insert(orderTransitions).values({
        orderId: row.id,
        fromState: saga.state,
        toState: result.saga.state,
        cause: event.type,
      });
      await enqueue(
        tx,
        outbox,
        result.messages.map((m) => outboxRow(sagaEnvelope(m, row.id, event.id))),
      );
      return true;
    });

    if (wrote) this.relay.nudge();
  }
}
