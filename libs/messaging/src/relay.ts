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
  intervalMs?: number;
  batchSize?: number;
  log?: (msg: string, err?: unknown) => void;
}

// publishes outbox rows in order (SKIP LOCKED, so instances can share it). At-least-once:
// a republish after a crash is dropped by JetStream (msgID = row id) and by consumer inboxes.
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
          async (span) => {
            const h = headers();
            for (const [k, v] of Object.entries(currentTraceHeaders())) h.set(k, v);
            const ack = await js.publish(row.subject, JSON.stringify(row.envelope), {
              msgID: row.id,
              headers: h,
            });
            // re-published after a crash: JetStream kept only the first copy.
            if (ack.duplicate) {
              span.setAttribute("messaging.nats.duplicate", true);
              span.addEvent("duplicate dropped by JetStream (same message id)");
            }
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
