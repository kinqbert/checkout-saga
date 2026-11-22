import { connectBus, openDatabase, type Bus, type Database } from "@checkout/messaging";
import { Inject, Injectable, type OnApplicationShutdown, type Provider } from "@nestjs/common";
import { resolve } from "node:path";

export const SERVICE = "notify";
export const DB = Symbol("DB");
export const BUS = Symbol("BUS");

/** Notify only consumes, so it needs no outbox relay. */
@Injectable()
class Lifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(BUS) private readonly bus: Bus,
  ) {}
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
        maxConnections: 4,
      }),
  },
  { provide: BUS, useFactory: () => connectBus(SERVICE) },
  Lifecycle,
];
