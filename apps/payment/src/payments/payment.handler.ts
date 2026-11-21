import { PaymentCommand } from "@checkout/contracts";
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
import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { inbox, outbox, payments } from "../db/schema.js";
import { BUS, DB } from "../infra.js";
import { charge } from "./provider.js";

const CONSUMER = "payment";

/**
 * Payment is the saga's pivot step: once captured the order is confirmed, so
 * there is no refund compensation to design.
 */
@Injectable()
export class PaymentHandler implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly log = new Logger(PaymentHandler.name);
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
      filterSubjects: ["checkout.cmd.payment.>"],
      handle: (data) => this.handle(data),
      log: (m, e) => this.log.warn(`${m} ${e ?? ""}`),
    });
  }

  async beforeApplicationShutdown() {
    await this.consumer?.stop();
  }

  async handle(data: unknown): Promise<void> {
    const parsed = PaymentCommand.safeParse(data);
    if (!parsed.success) throw new PoisonMessageError(parsed.error.message);
    const cmd = parsed.data;
    const db = this.database.db;

    // Already decided for this order (e.g. a duplicate command): do not charge again.
    const [existing] = await db.select().from(payments).where(eq(payments.orderId, cmd.orderId));
    if (existing) return;

    // The slow external call stays outside the transaction so it does not hold
    // a connection; the provider dedupes on the order id if we retry.
    const result = await charge(cmd.orderId, cmd.payload.amount);

    const wrote = await db.transaction(async (tx) => {
      if (!(await claimMessage(tx, inbox, cmd.id, CONSUMER))) return false;
      const inserted = await tx
        .insert(payments)
        .values({
          id: randomUUID(),
          orderId: cmd.orderId,
          amount: cmd.payload.amount,
          status: result.ok ? "CAPTURED" : "FAILED",
          failureReason: result.ok ? null : result.reason,
        })
        .onConflictDoNothing({ target: payments.orderId })
        .returning();
      if (inserted.length === 0) return false;

      const event = result.ok
        ? { type: "checkout.evt.payment.captured" as const, payload: {} }
        : { type: "checkout.evt.payment.failed" as const, payload: { reason: result.reason } };
      await enqueue(tx, outbox, [outboxRow(sagaEnvelope(event, cmd.orderId, cmd.id))]);
      return true;
    });
    if (wrote) this.relay.nudge();
  }
}
