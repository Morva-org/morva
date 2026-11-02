// A minimal query interface over Postgres. Production uses node-postgres; tests use PGlite (the
// same Postgres engine, in-process), so SQL and migrations are exercised for real in both.
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** node-postgres pool, for production and local development. */
export async function connectPostgres(connectionString: string): Promise<Db> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString, max: 10 });
  const wrap = (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }): Db => ({
    async query<T>(sql: string, params?: unknown[]) {
      return (await client.query(sql, params)).rows as T[];
    },
    transaction: () => {
      throw new Error("Nested transactions are not supported");
    },
    close: async () => {},
  });
  return {
    async query<T>(sql: string, params?: unknown[]) {
      return (await pool.query(sql, params)).rows as T[];
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(wrap(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** In-process Postgres (PGlite), for tests. */
export async function connectMemory(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const lite = new PGlite();
  type Queryable = { query: <R>(sql: string, params?: unknown[]) => Promise<{ rows: R[] }> };
  const wrap = (q: Queryable): Db => ({
    async query<T>(sql: string, params?: unknown[]) {
      return (await q.query<T>(sql, params)).rows;
    },
    transaction: () => {
      throw new Error("Nested transactions are not supported");
    },
    close: async () => {},
  });
  return {
    async query<T>(sql: string, params?: unknown[]) {
      return (await lite.query<T>(sql, params)).rows;
    },
    transaction: <T>(fn: (tx: Db) => Promise<T>) => lite.transaction(tx => fn(wrap(tx as unknown as Queryable))),
    close: () => lite.close(),
  };
}

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "migrations");

/** Applies any migrations not yet recorded, in filename order, each in its own transaction. */
export async function migrate(db: Db): Promise<string[]> {
  await db.query("CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await db.query<{ name: string }>("SELECT name FROM schema_migration")).map(r => r.name));
  const files = (await readdir(MIGRATIONS)).filter(f => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS, file), "utf8");
    await db.transaction(async tx => {
      for (const statement of splitStatements(sql)) await tx.query(statement);
      await tx.query("INSERT INTO schema_migration (name) VALUES ($1)", [file]);
    });
    applied.push(file);
  }
  return applied;
}

/** Splits a migration file into statements. Migrations avoid semicolons inside strings. */
function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\n|$)/)
    .map(s => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
}
