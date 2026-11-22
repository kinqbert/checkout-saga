import { OutboxRelay, type Database } from "@checkout/messaging";
import { contextFromHeaders, withSpan } from "@checkout/telemetry";
import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { orders } from "../db/schema.js";
import { DB } from "../infra.js";
import { SagaRunner } from "./saga.runner.js";
import { WAITING_STATES } from "./saga.types.js";

const SWEEP_EVERY_MS = 1000;
const BATCH = 50;

/**
 * Gives up on sagas whose step didn't answer in time. Deadlines live on the
 * order row, so a sweep after a restart still finds every overdue saga. Each
 * overdue order is handled in its own transaction under a row lock that skips
 * rows another instance (or the event consumer) is busy with, and the timeout
 * runs through the same state machine as any event.
 */
@Injectable()
export class SagaTimeouts implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly log = new Logger(SagaTimeouts.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(
    @Inject(DB) private readonly database: Database,
    private readonly runner: SagaRunner,
    private readonly relay: OutboxRelay,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => {
      this.running ??= this.sweep()
        .then(() => undefined)
        .catch((err) => this.log.warn(`timeout sweep failed ${err}`))
        .finally(() => (this.running = undefined));
    }, SWEEP_EVERY_MS);
  }

  async beforeApplicationShutdown() {
    clearInterval(this.timer);
    await this.running;
  }

  /** Times out every overdue saga. Returns how many it moved on. */
  async sweep(): Promise<number> {
    const { db } = this.database;
    const overdue = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(inArray(orders.state, [...WAITING_STATES]), lt(orders.deadlineAt, new Date())))
      .orderBy(asc(orders.deadlineAt))
      .limit(BATCH);

    let moved = 0;
    for (const { id } of overdue) {
      const wrote = await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.id, id), inArray(orders.state, [...WAITING_STATES]), lt(orders.deadlineAt, new Date())))
          .for("update", { skipLocked: true });
        // Answered meanwhile, or someone else holds it: nothing to do.
        if (!row) return false;
        // Continue the saga's own trace (and its baggage: slow mode, lab id),
        // so the timeout and the compensation it starts show up in it.
        return withSpan(
          "saga timeout",
          {
            parent: contextFromHeaders(row.traceHeaders ?? {}),
            attributes: { "checkout.order_id": row.id, "checkout.saga.waiting_in": row.state },
          },
          () => this.runner.apply(tx, row, { type: "saga.timeout" }),
        );
      });
      if (wrote) moved++;
    }
    if (moved > 0) {
      this.log.log(`timed out ${moved} saga(s)`);
      this.relay.nudge();
    }
    return moved;
  }
}
