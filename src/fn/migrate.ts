import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveServerDir } from "./config";
import { getPool } from "./db";

const DEFAULT_CATEGORIES = [
  "Hortifrúti",
  "Laticínios",
  "Mercearia",
  "Bebidas",
  "Limpeza",
  "Padaria",
];

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
};

export async function runMigrations(client?: Queryable): Promise<void> {
  const db = client ?? getPool();
  const dir = resolveServerDir();
  await db.query(readFileSync(join(dir, "schema.sql"), "utf8"));
  await db.query(readFileSync(join(dir, "schema-pdv.sql"), "utf8"));
  await db.query(readFileSync(join(dir, "schema-estoque.sql"), "utf8"));
  await db.query(readFileSync(join(dir, "schema-financeiro.sql"), "utf8"));

  for (const name of DEFAULT_CATEGORIES) {
    await db.query(`INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [
      name,
    ]);
  }
}
