import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");

function loadEnv() {
  const out = {};
  if (!existsSync(envPath)) return out;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

const env = loadEnv();
const client = new pg.Client({
  host: env.DATABASE_HOST,
  port: Number(env.DATABASE_PORT || 5432),
  database: env.DATABASE_NAME,
  user: env.DATABASE_USER,
  password: env.DATABASE_PASSWORD,
  connectionTimeoutMillis: 10_000,
});

await client.connect();
console.log("connected");

for (const file of ["schema.sql", "schema-pdv.sql", "schema-estoque.sql", "schema-financeiro.sql"]) {
  const sql = readFileSync(join(root, "src/fn", file), "utf8");
  await client.query(sql);
  console.log("applied", file);
}

await client.end();
console.log("ok");
