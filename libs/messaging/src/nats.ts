import { connect, nanos, type NatsConnection } from "@nats-io/transport-node";
import {
  DiscardPolicy,
  jetstream,
  jetstreamManager,
  RetentionPolicy,
  StorageType,
  type JetStreamClient,
  type JetStreamManager,
  type StreamConfig,
} from "@nats-io/jetstream";

// CHECKOUT: limits retention (several consumers per subject) and a 2 min duplicate window for republishes.
// CATALOG: latest message per product only, a compacted log a new consumer can rebuild from.
export const Streams = {
  checkout: {
    name: "CHECKOUT",
    subjects: ["checkout.>"],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    max_age: nanos(7 * 24 * 60 * 60 * 1000),
    duplicate_window: nanos(2 * 60 * 1000),
    discard: DiscardPolicy.Old,
  },
  catalog: {
    name: "CATALOG",
    subjects: ["catalog.>"],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    max_msgs_per_subject: 1,
    duplicate_window: nanos(2 * 60 * 1000),
    discard: DiscardPolicy.Old,
  },
} satisfies Record<string, Partial<StreamConfig> & { name: string; subjects: string[] }>;

export const catalogSubject = (sku: string) => `catalog.product.${sku}`;

export interface Bus {
  nc: NatsConnection;
  js: JetStreamClient;
  jsm: JetStreamManager;
}

export async function connectBus(name: string): Promise<Bus> {
  const nc = await connect({
    servers: process.env.NATS_URL ?? "nats://localhost:4222",
    name,
    maxReconnectAttempts: -1,
  });
  const jsm = await jetstreamManager(nc);
  await ensureStreams(jsm);
  return { nc, js: jetstream(nc), jsm };
}

// creates or updates the streams; every service calls it on boot.
export async function ensureStreams(jsm: JetStreamManager): Promise<void> {
  for (const cfg of Object.values(Streams)) {
    try {
      await jsm.streams.info(cfg.name);
      await jsm.streams.update(cfg.name, cfg);
    } catch {
      try {
        await jsm.streams.add(cfg);
      } catch (err) {
        await jsm.streams.info(cfg.name).catch(() => {
          throw err;
        });
      }
    }
  }
}
