import { TraceAttr } from "@checkout/contracts";
import { baggageValue, contextFromHeaders, flushTelemetry, LAB_KEY, slowModeHold, SpanKind, withSpan } from "@checkout/telemetry";
import type { LabFaults } from "./lab.js";
import {
  AckPolicy,
  DeliverPolicy,
  type ConsumerConfig,
  type ConsumerMessages,
  type JsMsg,
} from "@nats-io/jetstream";
import { nanos } from "@nats-io/transport-node";
import type { Bus } from "./nats.js";

/** Throw from a handler when a message can never succeed; it is terminated, not retried. */
export class PoisonMessageError extends Error {
  override name = "PoisonMessageError";
}

export interface MessageContext {
  subject: string;
  deliveryCount: number;
}

export interface ConsumerOptions {
  bus: Bus;
  stream: string;
  durable: string;
  filterSubjects: string[];
  handle: (data: unknown, ctx: MessageContext) => Promise<void>;
  maxDeliver?: number;
  /** Failure-lab switches owned by this service (see lab.ts). */
  faults?: LabFaults;
  /**
   * Messages handled at once (default 64). Work is mostly waiting (a payment
   * provider call, a slow-mode hold), so this sets throughput: 64 slots at
   * ~325 ms per fake charge ≈ 200 payments/s.
   */
  concurrency?: number;
  log?: (msg: string, err?: unknown) => void;
}

/** Exponential-ish backoff for naks: 0.5s, 1s, 2s … capped at 15s. */
const retryDelay = (deliveryCount: number) =>
  Math.min(15_000, 500 * 2 ** Math.max(0, deliveryCount - 1));

/**
 * Runs a durable pull consumer. Each message gets a CONSUMER span that
 * continues the producer's trace (from NATS headers). Success acks, a
 * PoisonMessageError or unparsable JSON terminates, anything else naks with a
 * backoff so the message is redelivered.
 */
export async function startConsumer(opts: ConsumerOptions): Promise<{ stop(): Promise<void> }> {
  const { bus, stream, durable } = opts;
  const log = opts.log ?? ((m, e) => console.error(`[${durable}] ${m}`, e ?? ""));

  const config: Partial<ConsumerConfig> = {
    durable_name: durable,
    ack_policy: AckPolicy.Explicit,
    deliver_policy: DeliverPolicy.All,
    filter_subjects: opts.filterSubjects,
    // Unlimited: a message is only given up on when it is poison (term()), so
    // a long outage (real or failure-lab) can never silently drop work.
    max_deliver: opts.maxDeliver ?? -1,
    ack_wait: nanos(30_000),
  };
  try {
    await bus.jsm.consumers.info(stream, durable);
    await bus.jsm.consumers.update(stream, durable, {
      filter_subjects: config.filter_subjects,
      max_deliver: config.max_deliver,
      ack_wait: config.ack_wait,
    });
  } catch {
    await bus.jsm.consumers.add(stream, config);
  }

  const consumer = await bus.js.consumers.get(stream, durable);
  const limit = opts.concurrency ?? 64;
  // Pull ahead of the work so the in-flight slots never sit idle.
  const messages: ConsumerMessages = await consumer.consume({ max_messages: limit * 2 });

  const inFlight = new Set<Promise<void>>();
  const loop = (async () => {
    for await (const msg of messages) {
      const p = process(msg).finally(() => inFlight.delete(p));
      inFlight.add(p);
      if (inFlight.size >= limit) await Promise.race(inFlight);
    }
    await Promise.all(inFlight);
  })();

  async function process(msg: JsMsg): Promise<void> {
    const carrier: Record<string, string> = {};
    for (const key of msg.headers?.keys() ?? []) carrier[key.toLowerCase()] = msg.headers!.get(key);

    try {
      const outcome = await withSpan(
        `process ${msg.subject}`,
        {
          kind: SpanKind.CONSUMER,
          parent: contextFromHeaders(carrier),
          attributes: {
            [TraceAttr.subject]: msg.subject,
            "messaging.consumer.group.name": durable,
            "messaging.message.delivery_count": msg.info.deliveryCount,
          },
        },
        async (span) => {
          let data: unknown;
          try {
            data = msg.json();
          } catch {
            throw new PoisonMessageError("payload is not JSON");
          }
          const env = data as { id?: string; type?: string; orderId?: string };
          if (env.type) span.setAttribute(TraceAttr.messageType, env.type);
          if (env.id) span.setAttribute(TraceAttr.messageId, env.id);
          if (env.orderId) span.setAttribute(TraceAttr.orderId, env.orderId);

          // Failure lab: this service is "down" for the visitor who sent it.
          // Refuse it; JetStream keeps it and redelivers in a second.
          const lab = baggageValue(LAB_KEY);
          if (lab && opts.faults?.isDown(lab)) {
            span.setAttribute("demo.lab.refused", true);
            span.addEvent("refused: service is down (failure lab)");
            return "retry" as const;
          }

          // Slow mode (W3C baggage set by the gateway): hold the message so a
          // person can follow it. The hold is its own span, so the trace says so.
          if (msg.info.deliveryCount === 1) await slowModeHold();
          await opts.handle(data, { subject: msg.subject, deliveryCount: msg.info.deliveryCount });

          // Failure lab: the work is committed, then the process "crashes"
          // before acking. JetStream redelivers; the inbox must catch it.
          if (lab && opts.faults?.takeCrash(lab)) {
            span.setAttribute("demo.lab.crashed", true);
            span.addEvent("crashed before ack (failure lab)");
            return "redeliver" as const;
          }
          // Failure lab: a real crash. The step is committed and acked, then
          // the process exits; its supervisor restarts it, and the saga goes
          // on from what is stored (order row, outbox, unacked replies).
          if (lab && opts.faults?.takeKill(lab)) {
            span.setAttribute("demo.lab.killed", true);
            span.addEvent("process killed after this step (failure lab)");
            return "kill" as const;
          }
          return "ack" as const;
        },
      );
      if (outcome === "retry") msg.nak(1000);
      else if (outcome === "redeliver") msg.nak(200);
      else if (outcome === "kill") {
        await msg.ackAck().catch(() => false);
        log(`failure lab: exiting the process after ${msg.subject}`);
        await flushTelemetry();
        globalThis.process.exit(1); // `process` is shadowed by process(msg) below
      } else msg.ack();
    } catch (err) {
      if (err instanceof PoisonMessageError) {
        log(`terminating poison message on ${msg.subject}: ${err.message}`);
        msg.term(err.message);
      } else {
        log(`handler failed on ${msg.subject} (delivery ${msg.info.deliveryCount})`, err);
        msg.nak(retryDelay(msg.info.deliveryCount));
      }
    }
  }

  return {
    async stop() {
      await messages.close();
      await loop.catch(() => undefined);
    },
  };
}
