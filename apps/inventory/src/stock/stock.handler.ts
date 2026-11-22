import {
  InventoryCommand,
  type Item,
  type ReleaseStockCmd,
  type ReserveStockCmd,
  type StockRejectedEvt,
} from "@checkout/contracts";
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
  type Tx,
} from "@checkout/messaging";
import { withSpan } from "@checkout/telemetry";
import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { inbox, outbox, products, reservations } from "../db/schema.js";
import { seedLevel } from "../products/seed.js";
import { BUS, DB } from "../infra.js";

const CONSUMER = "inventory";

/** Handles reserve/release commands from the order saga. */
@Injectable()
export class StockHandler implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly log = new Logger(StockHandler.name);
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
      filterSubjects: ["checkout.cmd.inventory.>"],
      handle: (data) => this.handle(data),
      faults: this.faults,
      log: (m, e) => this.log.warn(`${m} ${e ?? ""}`),
    });
  }

  async beforeApplicationShutdown() {
    await this.consumer?.stop();
  }

  async handle(data: unknown): Promise<void> {
    const parsed = InventoryCommand.safeParse(data);
    if (!parsed.success) throw new PoisonMessageError(parsed.error.message);
    const cmd = parsed.data;

    const wrote = await this.database.db.transaction(async (tx) => {
      if (!(await claimMessage(tx, inbox, cmd.id, CONSUMER))) return false;
      switch (cmd.type) {
        case "checkout.cmd.inventory.reserve":
          await this.reserve(tx, cmd);
          break;
        case "checkout.cmd.inventory.release":
          await this.release(tx, cmd);
          break;
      }
      return true;
    });
    if (wrote) this.relay.nudge();
  }

  /** All-or-nothing: either every line is reserved or none is. */
  private async reserve(tx: Tx, cmd: ReserveStockCmd): Promise<void> {
    const items: Item[] = cmd.payload.items;
    const skus = items.map((i) => i.sku);
    // Lock in a stable order so two concurrent reservations cannot deadlock.
    const rows = await tx
      .select()
      .from(products)
      .where(inArray(products.sku, skus))
      .orderBy(asc(products.sku))
      .for("update");
    const bySku = new Map(rows.map((r) => [r.sku, r]));

    // Regular products never run out: the supplier tops them back up to their
    // normal level (at least what this order needs). Limited ones really can.
    const replenish = items.filter((i) => {
      const r = bySku.get(i.sku);
      return r && !r.limited && r.stock < i.quantity;
    });
    if (replenish.length > 0) {
      await withSpan("supplier restock", { attributes: { "inventory.skus": replenish.map((i) => i.sku).join(",") } }, async () => {
        for (const i of replenish) {
          const level = Math.max(seedLevel(i.sku), i.quantity);
          await tx.update(products).set({ stock: level }).where(eq(products.sku, i.sku));
          bySku.get(i.sku)!.stock = level;
        }
      });
    }

    const unknown = skus.filter((s) => !bySku.has(s));
    const short = items.filter((i) => (bySku.get(i.sku)?.stock ?? 0) < i.quantity).map((i) => i.sku);

    if (unknown.length > 0 || short.length > 0) {
      const payload: StockRejectedEvt["payload"] =
        unknown.length > 0
          ? { reason: `unknown products: ${unknown.join(", ")}`, skus: unknown }
          : { reason: `out of stock: ${short.map((s) => bySku.get(s)!.name).join(", ")}`, skus: short };
      await this.emit(tx, { type: "checkout.evt.inventory.rejected", payload }, cmd);
      return;
    }

    for (const i of items) {
      await tx
        .update(products)
        .set({ stock: sql`${products.stock} - ${i.quantity}` })
        .where(eq(products.sku, i.sku));
    }
    await tx.insert(reservations).values({ orderId: cmd.orderId, items, status: "RESERVED" });
    await this.emit(tx, { type: "checkout.evt.inventory.reserved", payload: {} }, cmd);
  }

  /** Compensation. Safe to run when nothing was reserved: it still confirms. */
  private async release(tx: Tx, cmd: ReleaseStockCmd): Promise<void> {
    const [reservation] = await tx
      .update(reservations)
      .set({ status: "RELEASED" })
      .where(and(eq(reservations.orderId, cmd.orderId), eq(reservations.status, "RESERVED")))
      .returning();
    for (const i of reservation?.items ?? []) {
      await tx
        .update(products)
        .set({ stock: sql`${products.stock} + ${i.quantity}` })
        .where(eq(products.sku, i.sku));
    }
    await this.emit(tx, { type: "checkout.evt.inventory.released", payload: {} }, cmd);
  }

  private emit(
    tx: Tx,
    message: { type: string; payload: unknown },
    cause: { id: string; orderId: string },
  ): Promise<void> {
    return enqueue(tx, outbox, [outboxRow(sagaEnvelope(message, cause.orderId, cause.id))]);
  }
}
