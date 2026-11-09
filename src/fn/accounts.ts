import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query, withTransaction } from "./db";
import { requireUser } from "./require-user";

export type AccountRow = {
  id: number;
  direction: "payable" | "receivable";
  party_name: string;
  account_kind: string;
  document_code: string | null;
  description: string | null;
  amount: string;
  due_at: string;
  status: string;
  paid_at: string | null;
};

async function refreshOverdue() {
  await query(
    `UPDATE accounts
     SET status = 'overdue'
     WHERE status = 'open' AND due_at < CURRENT_DATE`,
  );
}

export const listAccounts = createServerFn({ method: "GET" })
  .validator(
    z
      .object({
        direction: z.enum(["payable", "receivable"]).optional(),
        search: z.string().optional(),
        status: z.enum(["open", "overdue", "paid", "cancelled"]).optional(),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    await requireUser();
    await refreshOverdue();

    const params: unknown[] = [];
    const where: string[] = [`status <> 'cancelled'`];

    if (data?.direction) {
      params.push(data.direction);
      where.push(`direction = $${params.length}`);
    }
    if (data?.status) {
      params.push(data.status);
      where.push(`status = $${params.length}`);
    }
    if (data?.search?.trim()) {
      params.push(`%${data.search.trim()}%`);
      where.push(
        `(party_name ILIKE $${params.length} OR COALESCE(document_code,'') ILIKE $${params.length} OR COALESCE(description,'') ILIKE $${params.length})`,
      );
    }

    const result = await query<AccountRow>(
      `SELECT id, direction, party_name, account_kind, document_code, description,
              amount::text, due_at::text, status, paid_at::text
       FROM accounts
       WHERE ${where.join(" AND ")}
       ORDER BY
         CASE status WHEN 'overdue' THEN 0 WHEN 'open' THEN 1 ELSE 2 END,
         due_at ASC
       LIMIT 200`,
      params,
    );
    return result.rows;
  });

export const getAccountsSummary = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  await refreshOverdue();

  const result = await query<{
    receive_today: string;
    pay_overdue: string;
    month_balance: string;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN direction = 'receivable' AND status IN ('open','overdue') AND due_at = CURRENT_DATE THEN amount ELSE 0 END), 0)::text AS receive_today,
       COALESCE(SUM(CASE WHEN direction = 'payable' AND status = 'overdue' THEN amount ELSE 0 END), 0)::text AS pay_overdue,
       (
         COALESCE(SUM(CASE WHEN direction = 'receivable' AND status IN ('open','overdue') AND due_at >= date_trunc('month', CURRENT_DATE)::date THEN amount ELSE 0 END), 0)
         -
         COALESCE(SUM(CASE WHEN direction = 'payable' AND status IN ('open','overdue') AND due_at >= date_trunc('month', CURRENT_DATE)::date THEN amount ELSE 0 END), 0)
       )::text AS month_balance
     FROM accounts
     WHERE status <> 'cancelled'`,
  );

  return {
    receiveToday: Number(result.rows[0]?.receive_today ?? 0),
    payOverdue: Number(result.rows[0]?.pay_overdue ?? 0),
    monthBalance: Number(result.rows[0]?.month_balance ?? 0),
  };
});

export const createAccount = createServerFn({ method: "POST" })
  .validator(
    z.object({
      direction: z.enum(["payable", "receivable"]),
      partyName: z.string().min(1).max(160),
      accountKind: z
        .enum(["fiado", "crediario", "card", "boleto", "utility", "other"])
        .default("other"),
      documentCode: z.string().max(120).optional(),
      description: z.string().max(500).optional(),
      amount: z.coerce.number().positive(),
      dueAt: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const due = new Date(data.dueAt);
    const status = due < new Date(new Date().toDateString()) ? "overdue" : "open";
    const result = await query<{ id: number }>(
      `INSERT INTO accounts
         (direction, party_name, account_kind, document_code, description, amount, due_at, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9)
       RETURNING id`,
      [
        data.direction,
        data.partyName.trim(),
        data.accountKind,
        data.documentCode?.trim() || null,
        data.description?.trim() || null,
        data.amount,
        data.dueAt,
        status,
        user.id,
      ],
    );
    return { id: result.rows[0]!.id };
  });

export const settleAccount = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.number().int().positive(),
      bankAccountId: z.number().int().positive().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return withTransaction(async (client) => {
      const account = await client.query<AccountRow>(
        `SELECT id, direction, party_name, account_kind, document_code, description,
                amount::text, due_at::text, status, paid_at::text
         FROM accounts WHERE id = $1 FOR UPDATE`,
        [data.id],
      );
      const row = account.rows[0];
      if (!row) throw new Error("Conta não encontrada.");
      if (row.status === "paid") throw new Error("Conta já está paga.");

      let bankId = data.bankAccountId ?? null;
      if (!bankId) {
        const def = await client.query<{ id: number }>(
          `SELECT id FROM bank_accounts WHERE is_default = TRUE AND active = TRUE LIMIT 1`,
        );
        bankId = def.rows[0]?.id ?? null;
      }

      await client.query(
        `UPDATE accounts SET status = 'paid', paid_at = NOW() WHERE id = $1`,
        [data.id],
      );

      const type = row.direction === "receivable" ? "income" : "expense";
      const amount = Number(row.amount);
      await client.query(
        `INSERT INTO financial_entries
           (type, description, category, origin, amount, status, occurred_at, created_by, bank_account_id)
         VALUES ($1, $2, $3, $4, $5, 'confirmed', NOW(), $6, $7)`,
        [
          type,
          `${row.direction === "receivable" ? "Recebimento" : "Pagamento"}: ${row.party_name}`,
          row.direction === "receivable" ? "Contas a receber" : "Contas a pagar",
          row.direction === "receivable" ? "Contas a receber" : "Contas a pagar",
          amount,
          user.id,
          bankId,
        ],
      );

      if (bankId) {
        const delta = type === "income" ? amount : -amount;
        await client.query(`UPDATE bank_accounts SET balance = balance + $1 WHERE id = $2`, [
          delta,
          bankId,
        ]);
      }

      return { ok: true as const };
    });
  });
