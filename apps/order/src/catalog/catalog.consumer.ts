import { ProductUpsertedEvt } from "@checkout/contracts";
import {
  PoisonMessageError,
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
import { sql } from "drizzle-orm";
import { products } from "../db/schema.js";
import { BUS, DB } from "../infra.js";

/**
 * Keeps orders.products in sync with inventory's catalog. The upsert is
 * naturally idempotent and ignores events older than what is stored, so no
 * inbox is needed here.
 */
@Injectable()
export class CatalogConsumer implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly log = new Logger(CatalogConsumer.name);
  private consumer?: { stop(): Promise<void> };

  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(BUS) private readonly bus: Bus,
  ) {}

  async onApplicationBootstrap() {
    this.consumer = await startConsumer({
      bus: this.bus,
      stream: Streams.catalog.name,
      durable: "order-catalog",
      filterSubjects: ["catalog.product.>"],
      handle: (data) => this.handle(data),
      log: (m, e) => this.log.warn(`${m} ${e ?? ""}`),
    });
  }

  async beforeApplicationShutdown() {
    await this.consumer?.stop();
  }

  async handle(data: unknown): Promise<void> {
    const parsed = ProductUpsertedEvt.safeParse(data);
    if (!parsed.success) throw new PoisonMessageError(parsed.error.message);
    const { payload, occurredAt } = parsed.data;
    const at = new Date(occurredAt);

    await this.database.db
      .insert(products)
      .values({ ...payload, sourceUpdatedAt: at })
      .onConflictDoUpdate({
        target: products.sku,
        set: { name: payload.name, price: payload.price, sourceUpdatedAt: at },
        setWhere: sql`${products.sourceUpdatedAt} <= ${at}`,
      });
  }
}
