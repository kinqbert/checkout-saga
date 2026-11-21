import {
  connectBus,
  openDatabase,
  OutboxRelay,
  type Bus,
  type Database,
} from "@checkout/messaging";
import {
  Inject,
  Injectable,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type Provider,
} from "@nestjs/common";
import { resolve } from "node:path";
import { outbox } from "./db/schema.js";

export const SERVICE = "inventory";
export const DB = Symbol("DB");
export const BUS = Symbol("BUS");

@Injectable()
class Lifecycle implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown {
  constructor(
    private readonly relay: OutboxRelay,
    @Inject(DB) private readonly database: Database,
    @Inject(BUS) private readonly bus: Bus,
  ) {}
  onApplicationBootstrap() {
    this.relay.start();
  }
  async beforeApplicationShutdown() {
    await this.relay.stop();
  }
  async onApplicationShutdown() {
    await this.bus.nc.drain();
    await this.database.pool.end();
  }
}

export const infraProviders: Provider[] = [
  {
    provide: DB,
    useFactory: () =>
      openDatabase({
        service: SERVICE,
        migrationsFolder: resolve(import.meta.dirname, "..", "drizzle"),
      }),
  },
  { provide: BUS, useFactory: () => connectBus(SERVICE) },
  {
    provide: OutboxRelay,
    inject: [DB, BUS],
    useFactory: (database: Database, bus: Bus) =>
      new OutboxRelay({ db: database.db, table: outbox, js: bus.js }),
  },
  Lifecycle,
];
