import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const connectionString = process.env.DATABASE_URL;

// Supabase recommends TLS on every connection, but its dashboard pooler URI
// omits `sslmode=require`. Detect a supabase.co host without an explicit
// sslmode and enable TLS so the pool connects out of the box. Local Postgres
// (or any host that sets sslmode itself) is left untouched.
const isSupabaseHost = /\.supabase\.co/i.test(connectionString);
const hasSslMode = /[?&]sslmode=/i.test(connectionString);

const ssl =
  isSupabaseHost && !hasSslMode ? { rejectUnauthorized: false } : undefined;

export const pool = new Pool({ connectionString, ...(ssl ? { ssl } : {}) });
export const db = drizzle(pool, { schema });

export * from "./schema";
