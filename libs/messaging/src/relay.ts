import { TraceAttr } from "@checkout/contracts";
import { contextFromHeaders, currentTraceHeaders, SpanKind, withSpan } from "@checkout/telemetry";
import type { JetStreamClient } from "@nats-io/jetstream";
import { headers } from "@nats-io/transport-node";
import { inArray, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { OutboxTable } from "./tables.js";

export interface RelayOptions {
  db: NodePgDatabase<any>;
  table: OutboxTable;
  js: JetStreamClient;
  /** Poll interval when idle. `nudge()` wakes the relay up earlier. */
  intervalMs?: number;
  batchSize?: number;
  log?: (msg: string, err?: unknown) => void;
}

/**
 * Publishes unpublished outbox rows to JetStream in `seq` order and marks them
 * published. Rows are locked with SKIP LOCKED, so running several relay
 * instances is safe. Publishing is at-least-once: a crash between publish and
 * the UPDATE republishes, which the stream drops as a duplicate (msgID = row
 * id) inside its duplicate window, and consumer inboxes drop after it.
 */
export class OutboxRelay {
  private running = false;
  private wake?: () => void;
  private loop?: Promise<void>;
  private readonly interval: number;
  private readonly batch: number;
  private readonly log: (msg: string, err?: unknown) => void;

  constructor(private readonly opts: RelayOptions) {
    this.interval = opts.intervalMs ?? 500;
    this.batch = opts.batchSize ?? 100;
    this.log = opts.log ?? ((m, e) => console.error(`[outbox] ${m}`, e ?? ""));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loop;
  }

  /** Call after committing a transaction that wrote outbox rows. */
  nudge(): void {
    this.wake?.();
  }

  private async run(): Promise<void> {
    while (this.running) {
      let published = 0;
      try {
        published = await this.flush();
      } catch (err) {
        this.log("publish failed, retrying", err);
        await this.sleep(1000);
        continue;
      }
      if (published < this.batch) await this.sleep(this.interval);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wake = done;
    });
  }

  /** Publishes one batch. Returns how many rows it published. */
  async flush(): Promise<number> {
    const { db, table, js } = this.opts;
    return db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(table)
        .where(isNull(table.publishedAt))
        .orderBy(table.seq)
        .limit(this.batch)
        .for("update", { skipLocked: true });
      if (rows.length === 0) return 0;

      for (const row of rows) {
        const env = row.envelope as { type: string; orderId?: string };
        await withSpan(
          `publish ${row.subject}`,
          {
            kind: SpanKind.PRODUCER,
            parent: contextFromHeaders(row.headers),
            attributes: {
              [TraceAttr.subject]: row.subject,
              [TraceAttr.messageType]: env.type,
              [TraceAttr.messageId]: row.id,
              ...(env.orderId ? { [TraceAttr.orderId]: env.orderId } : {}),
            },
          },
          async () => {
            const h = headers();
            for (const [k, v] of Object.entries(currentTraceHeaders())) h.set(k, v);
            await js.publish(row.subject, JSON.stringify(row.envelope), {
              msgID: row.id,
              headers: h,
            });
          },
        );
      }

      await tx
        .update(table)
        .set({ publishedAt: new Date() })
        .where(
          inArray(
            table.id,
            rows.map((r) => r.id),
          ),
        );
      return rows.length;
    });
  }
}
