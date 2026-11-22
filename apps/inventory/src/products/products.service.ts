import type { ProductUpsertedEvt, ProductView } from "@checkout/contracts";
import {
  catalogSubject,
  enqueue,
  outboxRow,
  OutboxRelay,
  plainEnvelope,
  type Database,
  type Tx,
} from "@checkout/messaging";
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { asc, eq, sql } from "drizzle-orm";
import { outbox, products } from "../db/schema.js";
import { DB } from "../infra.js";
import { SEED_PRODUCTS } from "./seed.js";

type ProductRow = typeof products.$inferSelect;

const toView = (p: ProductRow): ProductView => ({
  sku: p.sku,
  name: p.name,
  price: p.price,
  stock: p.stock,
});

// every catalog change goes out as an event so other services can replicate it.
function upserted(p: ProductRow) {
  const env = plainEnvelope<Pick<ProductUpsertedEvt, "type" | "payload">>({
    type: "catalog.evt.product.upserted",
    payload: { sku: p.sku, name: p.name, price: p.price },
  });
  return outboxRow(env, catalogSubject(p.sku));
}

@Injectable()
export class ProductsService implements OnApplicationBootstrap {
  private readonly log = new Logger(ProductsService.name);

  constructor(
    @Inject(DB) private readonly database: Database,
    private readonly relay: OutboxRelay,
  ) {}

  // seeds the demo catalog on first boot and announces it.
  async onApplicationBootstrap() {
    const inserted = await this.database.db.transaction(async (tx: Tx) => {
      const rows = await tx.insert(products).values([...SEED_PRODUCTS]).onConflictDoNothing().returning();
      await enqueue(tx, outbox, rows.map(upserted));
      return rows.length;
    });
    if (inserted > 0) {
      this.log.log(`seeded ${inserted} products`);
      this.relay.nudge();
    }
  }

  async list(): Promise<ProductView[]> {
    const rows = await this.database.db.select().from(products).orderBy(asc(products.price));
    return rows.map(toView);
  }

  // demo helper: puts stock back to the seed levels.
  async restock(): Promise<ProductView[]> {
    await this.database.db.transaction(async (tx) => {
      for (const p of SEED_PRODUCTS) {
        await tx.update(products).set({ stock: p.stock }).where(eq(products.sku, p.sku));
      }
    });
    return this.list();
  }

  // changes a price and publishes it; the order service's replica follows.
  async setPrice(sku: string, price: number): Promise<ProductView | undefined> {
    const row = await this.database.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(products)
        .set({ price, updatedAt: sql`now()` })
        .where(eq(products.sku, sku))
        .returning();
      if (updated) await enqueue(tx, outbox, [upserted(updated)]);
      return updated;
    });
    if (row) this.relay.nudge();
    return row && toView(row);
  }
}
