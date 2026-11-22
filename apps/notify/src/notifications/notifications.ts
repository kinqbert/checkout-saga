import { OrderEvent, type NotificationView } from "@checkout/contracts";
import {
  claimMessage,
  PoisonMessageError,
  startConsumer,
  Streams,
  type Bus,
  type Database,
} from "@checkout/messaging";
import { withSpan } from "@checkout/telemetry";
import {
  Controller,
  Get,
  Inject,
  Injectable,
  Logger,
  Query,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { inbox, notifications } from "../db/schema.js";
import { BUS, DB } from "../infra.js";

const CONSUMER = "notify";

/**
 * Reacts to the saga's outcome. It sits outside the saga on purpose: a failed
 * e-mail must never cancel a paid order.
 */
@Injectable()
export class NotificationsService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly log = new Logger(NotificationsService.name);
  private consumer?: { stop(): Promise<void> };

  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(BUS) private readonly bus: Bus,
  ) {}

  async onApplicationBootstrap() {
    this.consumer = await startConsumer({
      bus: this.bus,
      stream: Streams.checkout.name,
      durable: CONSUMER,
      filterSubjects: ["checkout.evt.order.>"],
      handle: (data) => this.handle(data),
      log: (m, e) => this.log.warn(`${m} ${e ?? ""}`),
    });
  }

  async beforeApplicationShutdown() {
    await this.consumer?.stop();
  }

  async handle(data: unknown): Promise<void> {
    const parsed = OrderEvent.safeParse(data);
    if (!parsed.success) throw new PoisonMessageError(parsed.error.message);
    const evt = parsed.data;
    const short = evt.orderId.slice(0, 8);
    const message =
      evt.type === "checkout.evt.order.confirmed"
        ? `Order ${short} confirmed. Receipt e-mailed.`
        : `Order ${short} cancelled: ${evt.payload.reason}`;

    await this.database.db.transaction(async (tx) => {
      if (!(await claimMessage(tx, inbox, evt.id, CONSUMER))) return;
      await withSpan("email.send", { attributes: { "email.template": evt.type } }, async () => {
        await new Promise((r) => setTimeout(r, 40 + Math.random() * 80));
      });
      await tx.insert(notifications).values({
        id: randomUUID(),
        orderId: evt.orderId,
        kind: evt.type === "checkout.evt.order.confirmed" ? "confirmed" : "cancelled",
        message,
      });
    });
  }

  async list(limit: number): Promise<NotificationView[]> {
    const rows = await this.database.db
      .select()
      .from(notifications)
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }
}

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  list(@Query("limit") limit?: string): Promise<NotificationView[]> {
    return this.service.list(Math.min(Math.max(Number(limit) || 20, 1), 100));
  }
}
