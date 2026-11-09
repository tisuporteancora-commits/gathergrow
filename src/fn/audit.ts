import type { PoolClient } from "pg";
import { query } from "./db";

export async function writeAudit(
  opts: {
    userId: number | null;
    action: string;
    entityType: string;
    entityId?: number | null;
    details?: Record<string, unknown>;
  },
  client?: PoolClient,
) {
  const params = [
    opts.userId,
    opts.action,
    opts.entityType,
    opts.entityId ?? null,
    JSON.stringify(opts.details ?? {}),
  ];
  const sql = `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
               VALUES ($1, $2, $3, $4, $5::jsonb)`;
  if (client) await client.query(sql, params);
  else await query(sql, params);
}
