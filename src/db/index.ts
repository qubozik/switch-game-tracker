import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Lazily create the connection so that `next build` (which imports route modules)
// does not fail when POSTGRES_URL is not yet configured. The client is only
// created the first time the database is actually queried at runtime.
const globalForDb = globalThis as unknown as {
  sqlClient?: ReturnType<typeof postgres>;
  drizzleDb?: ReturnType<typeof drizzle<typeof schema>>;
};

function getConnectionString(): string {
  const cs = process.env.POSTGRES_URL || process.env.DATABASE_URL || "";
  if (!cs) {
    throw new Error(
      "Database connection string is not set. Set POSTGRES_URL (Vercel Postgres) or DATABASE_URL.",
    );
  }
  return cs;
}

function getDb() {
  if (!globalForDb.drizzleDb) {
    const client =
      globalForDb.sqlClient ??
      postgres(getConnectionString(), { prepare: false, max: 1 });
    if (process.env.NODE_ENV !== "production") globalForDb.sqlClient = client;
    globalForDb.drizzleDb = drizzle(client, { schema });
  }
  return globalForDb.drizzleDb;
}

// Proxy that initializes the real Drizzle instance on first property access.
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop, receiver) {
    const real = getDb();
    const value = Reflect.get(real as object, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
