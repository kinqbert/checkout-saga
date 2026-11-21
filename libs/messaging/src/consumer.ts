import { TraceAttr } from "@checkout/contracts";
import { contextFromHeaders, SpanKind, withSpan } from "@checkout/telemetry";
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
    max_deliver: opts.maxDeliver ?? 20,
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
  const messages: ConsumerMessages = await consumer.consume({ max_messages: 64 });

  const loop = (async () => {
    for await (const msg of messages) {
      await process(msg);
    }
  })();

  async function process(msg: JsMsg): Promise<void> {
    const carrier: Record<string, string> = {};
    for (const key of msg.headers?.keys() ?? []) carrier[key.toLowerCase()] = msg.headers!.get(key);

    try {
      await withSpan(
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

          await opts.handle(data, { subject: msg.subject, deliveryCount: msg.info.deliveryCount });
        },
      );
      msg.ack();
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
