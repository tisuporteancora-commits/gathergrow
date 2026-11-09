import { randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { isSetupComplete, writeConfig } from "./config";
import { testConnection } from "./db";
import { runMigrations } from "./migrate";
import pg from "pg";

const setupSchema = z.object({
  host: z.string().min(1, "Informe o IP/host do Postgres"),
  port: z.coerce.number().int().min(1).max(65535).default(5432),
  database: z.string().min(1, "Informe o nome do banco"),
  dbUser: z.string().min(1, "Informe o usuário do banco"),
  dbPassword: z.string().min(1, "Informe a senha do banco"),
  adminUsername: z
    .string()
    .min(3, "Usuário admin com pelo menos 3 caracteres")
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, "Use apenas letras, números, ponto, _ ou -"),
  adminPassword: z.string().min(6, "Senha admin com pelo menos 6 caracteres"),
  adminName: z.string().min(2, "Informe o nome do administrador").default("Super Admin"),
});

export const getSetupStatus = createServerFn({ method: "GET" }).handler(async () => {
  return { setupComplete: isSetupComplete() };
});

export const completeSetup = createServerFn({ method: "POST" })
  .validator(setupSchema)
  .handler(async ({ data }) => {
    if (isSetupComplete()) {
      throw new Error("O sistema já foi configurado.");
    }

    const dbCreds = {
      host: data.host.trim(),
      port: data.port,
      database: data.database.trim(),
      user: data.dbUser.trim(),
      password: data.dbPassword,
    };

    try {
      await testConnection(dbCreds);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha na conexão";
      throw new Error(`Não foi possível conectar ao Postgres: ${message}`);
    }

    const jwtSecret = randomBytes(48).toString("hex");
    const client = new pg.Client({
      host: dbCreds.host,
      port: dbCreds.port,
      database: dbCreds.database,
      user: dbCreds.user,
      password: dbCreds.password,
    });

    try {
      await client.connect();
      await runMigrations(client);

      const passwordHash = await bcrypt.hash(data.adminPassword, 12);
      await client.query(
        `INSERT INTO users (username, password_hash, name, role)
         VALUES ($1, $2, $3, 'super_admin')`,
        [data.adminUsername.trim().toLowerCase(), passwordHash, data.adminName.trim()],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao preparar o banco";
      throw new Error(message);
    } finally {
      await client.end().catch(() => undefined);
    }

    writeConfig({
      ...dbCreds,
      jwtSecret,
      setupCompletedAt: new Date().toISOString(),
    });

    return { ok: true as const };
  });
