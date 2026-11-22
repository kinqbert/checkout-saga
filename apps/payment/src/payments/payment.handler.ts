import { PaymentCommand, type RefundPaymentCmd } from "@checkout/contracts";
import {
  claimMessage,
  LabFaults,
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
import { baggageValue, LAB_KEY } from "@checkout/telemetry";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { inbox, outbox, payments } from "../db/schema.js";
import { BUS, DB } from "../infra.js";
import { charge, refundCharge, slowProvider, type ChargeResult } from "./provider.js";

const CONSUMER = "payment";

// the saga's pivot step. The only refund is for a charge that lands after the order timed out.
@Injectable()
export class PaymentHandler implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly log = new Logger(PaymentHandler.name);
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
      filterSubjects: ["checkout.cmd.payment.>"],
      handle: (data) => this.handle(data),
      faults: this.faults,
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
    if (cmd.type === "checkout.cmd.payment.refund") return this.refund(cmd);
    const db = this.database.db;

    const [existing] = await db.select().from(payments).where(eq(payments.orderId, cmd.orderId));
    if (existing) return;

    const { deadline } = cmd.payload;
    let result: ChargeResult;
    if (deadline && Date.parse(deadline) < Date.now()) {
      // the order timed out and is being cancelled: don't take its money.
      result = { ok: false, reason: "the order stopped waiting for payment" };
    } else {
      // outside the transaction so a slow call doesn't hold a connection.
      result = await charge(cmd.orderId, cmd.payload.amount);
      // failure lab: charged, but the answer lands after the deadline, so the saga refunds it.
      const lab = baggageValue(LAB_KEY);
      if (lab && deadline && this.faults.isSlow(lab)) await slowProvider(deadline);
    }

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

  // idempotent: only a CAPTURED payment is refunded, and it always confirms.
  private async refund(cmd: RefundPaymentCmd): Promise<void> {
    const [payment] = await this.database.db.select().from(payments).where(eq(payments.orderId, cmd.orderId));
    if (payment?.status === "CAPTURED") await refundCharge(cmd.orderId, payment.amount);

    const wrote = await this.database.db.transaction(async (tx) => {
      if (!(await claimMessage(tx, inbox, cmd.id, CONSUMER))) return false;
      await tx
        .update(payments)
        .set({ status: "REFUNDED" })
        .where(and(eq(payments.orderId, cmd.orderId), eq(payments.status, "CAPTURED")));
      const event = { type: "checkout.evt.payment.refunded" as const, payload: {} };
      await enqueue(tx, outbox, [outboxRow(sagaEnvelope(event, cmd.orderId, cmd.id))]);
      return true;
    });
    if (wrote) this.relay.nudge();
  }
}
