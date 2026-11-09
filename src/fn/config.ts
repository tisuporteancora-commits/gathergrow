import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type AppConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  jwtSecret: string;
  setupCompletedAt: string;
};

const ENV_PATH = join(process.cwd(), ".env");

const KEYS = {
  host: "DATABASE_HOST",
  port: "DATABASE_PORT",
  database: "DATABASE_NAME",
  user: "DATABASE_USER",
  password: "DATABASE_PASSWORD",
  jwtSecret: "JWT_SECRET",
  setupCompletedAt: "SETUP_COMPLETED_AT",
} as const;

const MANAGED_KEYS = new Set(Object.values(KEYS));

export function getEnvPath() {
  return ENV_PATH;
}

function parseEnvFile(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function escapeEnvValue(value: string): string {
  if (/[\s#"']/.test(value) || value.includes("\\") || value.includes("\n")) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

function envOverride(key: string): Record<string, string> {
  const value = process.env[key];
  return value ? { [key]: value } : {};
}

function readEnvMap(): Record<string, string> {
  const fromFile = existsSync(ENV_PATH) ? parseEnvFile(readFileSync(ENV_PATH, "utf8")) : {};
  return {
    ...fromFile,
    ...envOverride(KEYS.host),
    ...envOverride(KEYS.port),
    ...envOverride(KEYS.database),
    ...envOverride(KEYS.user),
    ...envOverride(KEYS.password),
    ...envOverride(KEYS.jwtSecret),
    ...envOverride(KEYS.setupCompletedAt),
  };
}

export function isSetupComplete(): boolean {
  const env = readEnvMap();
  return Boolean(
    env[KEYS.host] &&
      env[KEYS.database] &&
      env[KEYS.user] &&
      env[KEYS.password] &&
      env[KEYS.jwtSecret] &&
      env[KEYS.setupCompletedAt],
  );
}

export function readConfig(): AppConfig | null {
  const env = readEnvMap();
  const host = env[KEYS.host];
  const database = env[KEYS.database];
  const user = env[KEYS.user];
  const password = env[KEYS.password];
  const jwtSecret = env[KEYS.jwtSecret];
  const setupCompletedAt = env[KEYS.setupCompletedAt];
  if (!host || !database || !user || !password || !jwtSecret || !setupCompletedAt) {
    return null;
  }
  return {
    host,
    port: Number(env[KEYS.port] || "5432"),
    database,
    user,
    password,
    jwtSecret,
    setupCompletedAt,
  };
}

export function writeConfig(config: AppConfig): void {
  const existing = existsSync(ENV_PATH) ? parseEnvFile(readFileSync(ENV_PATH, "utf8")) : {};
  const extras = Object.entries(existing).filter(([key]) => !MANAGED_KEYS.has(key as never));

  const lines = [
    "# MarketFlow — gerado/atualizado pelo setup inicial",
    `${KEYS.host}=${escapeEnvValue(config.host)}`,
    `${KEYS.port}=${escapeEnvValue(String(config.port))}`,
    `${KEYS.database}=${escapeEnvValue(config.database)}`,
    `${KEYS.user}=${escapeEnvValue(config.user)}`,
    `${KEYS.password}=${escapeEnvValue(config.password)}`,
    `${KEYS.jwtSecret}=${escapeEnvValue(config.jwtSecret)}`,
    `${KEYS.setupCompletedAt}=${escapeEnvValue(config.setupCompletedAt)}`,
  ];

  if (extras.length > 0) {
    lines.push("");
    lines.push("# Outras variáveis");
    for (const [key, value] of extras) {
      lines.push(`${key}=${escapeEnvValue(value)}`);
    }
  }

  lines.push("");
  writeFileSync(ENV_PATH, lines.join("\n"), "utf8");

  process.env[KEYS.host] = config.host;
  process.env[KEYS.port] = String(config.port);
  process.env[KEYS.database] = config.database;
  process.env[KEYS.user] = config.user;
  process.env[KEYS.password] = config.password;
  process.env[KEYS.jwtSecret] = config.jwtSecret;
  process.env[KEYS.setupCompletedAt] = config.setupCompletedAt;
}

export function requireConfig(): AppConfig {
  const config = readConfig();
  if (!config) throw new Error("Sistema ainda não foi configurado. Defina as variáveis no .env.");
  return config;
}

/** Absolute path helper kept for tests / tooling. */
export function resolveServerDir() {
  return dirname(fileURLToPath(import.meta.url));
}
