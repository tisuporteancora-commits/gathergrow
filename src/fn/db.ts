import pg from "pg";
import { readConfig, type AppConfig } from "./config";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let poolKey = "";

function connectionKey(c: Pick<AppConfig, "host" | "port" | "database" | "user" | "password">) {
  return `${c.user}@${c.host}:${c.port}/${c.database}:${c.password}`;
}

export function buildPoolConfig(c: Pick<AppConfig, "host" | "port" | "database" | "user" | "password">) {
  return {
    host: c.host,
    port: c.port,
    database: c.database,
    user: c.user,
    password: c.password,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
  };
}

export async function testConnection(
  c: Pick<AppConfig, "host" | "port" | "database" | "user" | "password">,
): Promise<void> {
  const client = new pg.Client(buildPoolConfig(c));
  try {
    await client.connect();
    await client.query("SELECT 1");
  } finally {
    await client.end().catch(() => undefined);
  }
}

export function getPool(): pg.Pool {
  const config = readConfig();
  if (!config) throw new Error("Sistema ainda não foi configurado.");
  const key = connectionKey(config);
  if (!pool || poolKey !== key) {
    if (pool) void pool.end().catch(() => undefined);
    pool = new Pool(buildPoolConfig(config));
    poolKey = key;
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return getPool().query<T>(text, params);
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
