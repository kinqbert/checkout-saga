import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export interface Database<TSchema = unknown> {
  db: NodePgDatabase<any> & { $schema?: TSchema };
  pool: pg.Pool;
}

/**
 * Opens a pool and applies the service's migrations. Every service shares one
 * Postgres but owns its own schema, so each gets its own migrations table.
 */
export async function openDatabase(opts: {
  service: string;
  migrationsFolder: string;
  url?: string;
  maxConnections?: number;
}): Promise<Database> {
  const pool = new pg.Pool({
    connectionString:
      opts.url ??
      process.env.DATABASE_URL ??
      "postgres://postgres:postgres@localhost:5433/checkout-saga",
    max: opts.maxConnections ?? 10,
  });
  const db = drizzle({ client: pool });
  await migrate(db, {
    migrationsFolder: opts.migrationsFolder,
    migrationsSchema: "public",
    migrationsTable: `__drizzle_migrations_${opts.service}`,
  });
  return { db, pool };
}
