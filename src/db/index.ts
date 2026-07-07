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
  // Direct, standard names first.
  const direct = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (direct) return direct;

  // Fall back to any prefixed variant created by the Vercel Neon integration,
  // e.g. SGT_POSTGRES_URL / SGT_DATABASE_URL. Prefer a pooled POSTGRES_URL.
  const keys = Object.keys(process.env);
  const pooled = keys.find(
    (k) => /(^|_)POSTGRES_URL$/.test(k) && process.env[k],
  );
  if (pooled) return process.env[pooled] as string;
  const dbUrl = keys.find(
    (k) => /(^|_)DATABASE_URL$/.test(k) && process.env[k],
  );
  if (dbUrl) return process.env[dbUrl] as string;

  throw new Error(
    "Database connection string is not set. Set POSTGRES_URL / DATABASE_URL (or a *_POSTGRES_URL / *_DATABASE_URL from the Neon integration).",
  );
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
