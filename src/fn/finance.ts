import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query, withTransaction } from "./db";
import { requireUser } from "./require-user";

export type FinancialEntryRow = {
  id: number;
  type: "income" | "expense";
  description: string;
  category: string;
  origin: string | null;
  amount: string;
  status: string;
  occurred_at: string;
  sale_id: number | null;
  bank_account_id: number | null;
  bank_account_name: string | null;
};

export type BankAccountRow = {
  id: number;
  name: string;
  kind: "cash" | "bank" | "digital";
  bank_name: string | null;
  agency: string | null;
  account_number: string | null;
  balance: string;
  active: boolean;
  is_default: boolean;
};

async function refreshOverdueAccounts() {
  await query(
    `UPDATE accounts
     SET status = 'overdue'
     WHERE status = 'open' AND due_at < CURRENT_DATE`,
  );
}

function originFromCategory(category: string, saleId: number | null): string {
  if (saleId || /pdv/i.test(category) || /venda/i.test(category)) return "PDV";
  if (/servi[cç]o/i.test(category)) return "Serviços";
  if (/receber/i.test(category)) return "Contas a receber";
  if (/pagar/i.test(category)) return "Contas a pagar";
  return category || "Outros";
}

export const listBankAccounts = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  const result = await query<BankAccountRow>(
    `SELECT id, name, kind, bank_name, agency, account_number,
            balance::text, active, is_default
     FROM bank_accounts
     WHERE active = TRUE
     ORDER BY is_default DESC, name ASC`,
  );
  return result.rows;
});

export const upsertBankAccount = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.number().int().positive().optional(),
      name: z.string().min(1).max(120),
      kind: z.enum(["cash", "bank", "digital"]).default("bank"),
      bankName: z.string().max(120).nullable().optional(),
      agency: z.string().max(32).nullable().optional(),
      accountNumber: z.string().max(64).nullable().optional(),
      balance: z.coerce.number().optional(),
      isDefault: z.boolean().optional(),
      active: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireUser();
    return withTransaction(async (client) => {
      if (data.isDefault) {
        await client.query(`UPDATE bank_accounts SET is_default = FALSE WHERE is_default = TRUE`);
      }
      if (data.id) {
        const result = await client.query<{ id: number }>(
          `UPDATE bank_accounts SET
             name=$1, kind=$2, bank_name=$3, agency=$4, account_number=$5,
             balance=COALESCE($6, balance),
             is_default=COALESCE($7, is_default),
             active=COALESCE($8, active)
           WHERE id=$9 RETURNING id`,
          [
            data.name.trim(),
            data.kind,
            data.bankName?.trim() || null,
            data.agency?.trim() || null,
            data.accountNumber?.trim() || null,
            data.balance,
            data.isDefault,
            data.active,
            data.id,
          ],
        );
        if (!result.rows[0]) throw new Error("Conta não encontrada.");
        return { id: result.rows[0].id };
      }
      const result = await client.query<{ id: number }>(
        `INSERT INTO bank_accounts
           (name, kind, bank_name, agency, account_number, balance, is_default)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,0),COALESCE($7,FALSE))
         RETURNING id`,
        [
          data.name.trim(),
          data.kind,
          data.bankName?.trim() || null,
          data.agency?.trim() || null,
          data.accountNumber?.trim() || null,
          data.balance ?? 0,
          data.isDefault ?? false,
        ],
      );
      return { id: result.rows[0]!.id };
    });
  });

export const listFinancialEntries = createServerFn({ method: "GET" })
  .validator(
    z
      .object({
        search: z.string().optional(),
        type: z.enum(["income", "expense"]).optional(),
        status: z.enum(["confirmed", "pending"]).optional(),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    await requireUser();
    const params: unknown[] = [];
    const where: string[] = [`e.status <> 'cancelled'`];

    if (data?.type) {
      params.push(data.type);
      where.push(`e.type = $${params.length}`);
    }
    if (data?.status) {
      params.push(data.status);
      where.push(`e.status = $${params.length}`);
    }
    if (data?.search?.trim()) {
      params.push(`%${data.search.trim()}%`);
      where.push(
        `(e.description ILIKE $${params.length} OR e.category ILIKE $${params.length})`,
      );
    }

    const result = await query<FinancialEntryRow>(
      `SELECT e.id, e.type, e.description, e.category, e.origin,
              e.amount::text, e.status, e.occurred_at::text, e.sale_id,
              e.bank_account_id, b.name AS bank_account_name
       FROM financial_entries e
       LEFT JOIN bank_accounts b ON b.id = e.bank_account_id
       WHERE ${where.join(" AND ")}
       ORDER BY e.occurred_at DESC
       LIMIT 200`,
      params,
    );
    return result.rows;
  });

export const getFinanceSummary = createServerFn({ method: "GET" }).handler(async () => {
  const dash = await getFinanceDashboardHandler({ periodDays: 30 });
  return {
    incomeMonth: dash.current.income,
    expenseMonth: dash.current.expense,
    balanceMonth: dash.current.result,
    daily: dash.balanceEvolution.map((d) => ({
      day: d.day,
      income: d.income,
      expense: d.expense,
    })),
  };
});

async function getFinanceDashboardHandler(opts: { periodDays?: number } = {}) {
  await requireUser();
  await refreshOverdueAccounts();

  const periodDays = opts.periodDays ?? 30;

  const banks = await query<BankAccountRow>(
    `SELECT id, name, kind, bank_name, agency, account_number,
            balance::text, active, is_default
     FROM bank_accounts WHERE active = TRUE
     ORDER BY is_default DESC, name ASC`,
  );

  const openCash = await query<{ expected: string }>(
    `SELECT COALESCE(SUM(
        s.opening_cash
        + COALESCE((
            SELECT SUM(p.amount) FROM payments p
            JOIN sales sa ON sa.id = p.sale_id
            WHERE sa.session_id = s.id AND sa.status = 'completed' AND p.method = 'cash'
          ), 0)
        + COALESCE((SELECT SUM(amount) FROM cash_movements WHERE session_id = s.id AND type = 'suprimento'), 0)
        - COALESCE((SELECT SUM(amount) FROM cash_movements WHERE session_id = s.id AND type = 'sangria'), 0)
      ), 0)::text AS expected
     FROM cash_sessions s
     WHERE s.status = 'open'`,
  );

  const bankTotal = banks.rows.reduce((s, b) => s + Number(b.balance), 0);
  const openCashExpected = Number(openCash.rows[0]?.expected ?? 0);
  // Evita contar caixa duas vezes se já existe conta kind=cash: usa o maior entre saldo cadastrado cash e caixa aberto
  const cashBook = banks.rows
    .filter((b) => b.kind === "cash")
    .reduce((s, b) => s + Number(b.balance), 0);
  const nonCashBanks = banks.rows
    .filter((b) => b.kind !== "cash")
    .reduce((s, b) => s + Number(b.balance), 0);
  const cashLiquidity = Math.max(cashBook, openCashExpected);
  const totalLiquidity = nonCashBanks + cashLiquidity;

  const current = await query<{ income: string; expense: string }>(
    `SELECT
       COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0)::text AS income,
       COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0)::text AS expense
     FROM financial_entries
     WHERE status='confirmed'
       AND occurred_at >= date_trunc('month', NOW())
       AND occurred_at < date_trunc('month', NOW()) + INTERVAL '1 month'`,
  );

  const previous = await query<{ income: string; expense: string }>(
    `SELECT
       COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0)::text AS income,
       COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0)::text AS expense
     FROM financial_entries
     WHERE status='confirmed'
       AND occurred_at >= date_trunc('month', NOW()) - INTERVAL '1 month'
       AND occurred_at < date_trunc('month', NOW())`,
  );

  const pendingEntries = await query<{ income: string; expense: string }>(
    `SELECT
       COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0)::text AS income,
       COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0)::text AS expense
     FROM financial_entries
     WHERE status='pending'`,
  );

  const accountsAgg = await query<{
    open_receivable: string;
    open_payable: string;
    overdue_receivable: string;
    overdue_payable: string;
    due7_receivable: string;
    due7_payable: string;
    due15_receivable: string;
    due15_payable: string;
    due30_receivable: string;
    due30_payable: string;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN direction='receivable' AND status IN ('open','overdue') THEN amount ELSE 0 END),0)::text AS open_receivable,
       COALESCE(SUM(CASE WHEN direction='payable' AND status IN ('open','overdue') THEN amount ELSE 0 END),0)::text AS open_payable,
       COALESCE(SUM(CASE WHEN direction='receivable' AND status='overdue' THEN amount ELSE 0 END),0)::text AS overdue_receivable,
       COALESCE(SUM(CASE WHEN direction='payable' AND status='overdue' THEN amount ELSE 0 END),0)::text AS overdue_payable,
       COALESCE(SUM(CASE WHEN direction='receivable' AND status IN ('open','overdue') AND due_at BETWEEN CURRENT_DATE AND CURRENT_DATE + 7 THEN amount ELSE 0 END),0)::text AS due7_receivable,
       COALESCE(SUM(CASE WHEN direction='payable' AND status IN ('open','overdue') AND due_at BETWEEN CURRENT_DATE AND CURRENT_DATE + 7 THEN amount ELSE 0 END),0)::text AS due7_payable,
       COALESCE(SUM(CASE WHEN direction='receivable' AND status IN ('open','overdue') AND due_at BETWEEN CURRENT_DATE AND CURRENT_DATE + 15 THEN amount ELSE 0 END),0)::text AS due15_receivable,
       COALESCE(SUM(CASE WHEN direction='payable' AND status IN ('open','overdue') AND due_at BETWEEN CURRENT_DATE AND CURRENT_DATE + 15 THEN amount ELSE 0 END),0)::text AS due15_payable,
       COALESCE(SUM(CASE WHEN direction='receivable' AND status IN ('open','overdue') AND due_at BETWEEN CURRENT_DATE AND CURRENT_DATE + 30 THEN amount ELSE 0 END),0)::text AS due30_receivable,
       COALESCE(SUM(CASE WHEN direction='payable' AND status IN ('open','overdue') AND due_at BETWEEN CURRENT_DATE AND CURRENT_DATE + 30 THEN amount ELSE 0 END),0)::text AS due30_payable
     FROM accounts
     WHERE status <> 'cancelled'`,
  );

  const delinquency = await query<{
    overdue_total: string;
    overdue_count: string;
    open_total: string;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN status='overdue' THEN amount ELSE 0 END),0)::text AS overdue_total,
       COALESCE(COUNT(*) FILTER (WHERE status='overdue'),0)::text AS overdue_count,
       COALESCE(SUM(CASE WHEN status IN ('open','overdue') THEN amount ELSE 0 END),0)::text AS open_total
     FROM accounts
     WHERE direction='receivable' AND status <> 'cancelled'`,
  );

  const topDelinquent = await query<{
    party_name: string;
    amount: string;
    due_at: string;
    days_overdue: string;
  }>(
    `SELECT party_name, amount::text, due_at::text,
            (CURRENT_DATE - due_at)::text AS days_overdue
     FROM accounts
     WHERE direction='receivable' AND status='overdue'
     ORDER BY amount DESC
     LIMIT 8`,
  );

  const expensesByCategory = await query<{ category: string; amount: string }>(
    `SELECT category, SUM(amount)::text AS amount
     FROM financial_entries
     WHERE status='confirmed' AND type='expense'
       AND occurred_at >= date_trunc('month', NOW())
     GROUP BY category
     ORDER BY SUM(amount) DESC
     LIMIT 12`,
  );

  const incomeByOrigin = await query<{ origin: string; amount: string }>(
    `SELECT COALESCE(NULLIF(origin,''),
            CASE
              WHEN sale_id IS NOT NULL OR category ILIKE '%PDV%' OR category ILIKE '%Venda%' THEN 'PDV'
              WHEN category ILIKE '%servi%' THEN 'Serviços'
              WHEN category ILIKE '%receber%' THEN 'Contas a receber'
              ELSE category
            END) AS origin,
            SUM(amount)::text AS amount
     FROM financial_entries
     WHERE status='confirmed' AND type='income'
       AND occurred_at >= date_trunc('month', NOW())
     GROUP BY 1
     ORDER BY SUM(amount) DESC
     LIMIT 12`,
  );

  const daily = await query<{ day: string; income: string; expense: string }>(
    `SELECT to_char(d::date, 'YYYY-MM-DD') AS day,
            COALESCE((
              SELECT SUM(amount) FROM financial_entries
              WHERE status='confirmed' AND type='income' AND occurred_at::date = d::date
            ),0)::text AS income,
            COALESCE((
              SELECT SUM(amount) FROM financial_entries
              WHERE status='confirmed' AND type='expense' AND occurred_at::date = d::date
            ),0)::text AS expense
     FROM generate_series(
       (CURRENT_DATE - ($1 || ' days')::interval)::date,
       CURRENT_DATE,
       '1 day'::interval
     ) AS d
     ORDER BY d`,
    [periodDays],
  );

  let running = totalLiquidity;
  // Rebuild evolution from start of window: start = current - net of period
  const periodNet = daily.rows.reduce(
    (s, r) => s + Number(r.income) - Number(r.expense),
    0,
  );
  running = totalLiquidity - periodNet;
  const balanceEvolution = daily.rows.map((r) => {
    const income = Number(r.income);
    const expense = Number(r.expense);
    running += income - expense;
    return {
      day: r.day,
      income,
      expense,
      balance: Math.round(running * 100) / 100,
    };
  });

  const curIncome = Number(current.rows[0]?.income ?? 0);
  const curExpense = Number(current.rows[0]?.expense ?? 0);
  const prevIncome = Number(previous.rows[0]?.income ?? 0);
  const prevExpense = Number(previous.rows[0]?.expense ?? 0);
  const curResult = curIncome - curExpense;
  const prevResult = prevIncome - prevExpense;

  const pct = (cur: number, prev: number) => {
    if (prev === 0) return cur === 0 ? 0 : 100;
    return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
  };

  const a = accountsAgg.rows[0]!;
  const forecastIncomePending = Number(pendingEntries.rows[0]?.income ?? 0);
  const forecastExpensePending = Number(pendingEntries.rows[0]?.expense ?? 0);

  const forecastBalance = (dueRecv: number, duePay: number) =>
    Math.round(
      (totalLiquidity + dueRecv + forecastIncomePending - duePay - forecastExpensePending) * 100,
    ) / 100;

  return {
    bankAccounts: banks.rows.map((b) => ({
      id: b.id,
      name: b.name,
      kind: b.kind,
      balance: Number(b.balance),
      bankName: b.bank_name,
      isDefault: b.is_default,
    })),
    openCashExpected,
    totalLiquidity: Math.round(totalLiquidity * 100) / 100,
    current: {
      income: curIncome,
      expense: curExpense,
      result: curResult,
    },
    forecasted: {
      income:
        Number(a.open_receivable) + forecastIncomePending,
      expense:
        Number(a.open_payable) + forecastExpensePending,
      pendingIncome: forecastIncomePending,
      pendingExpense: forecastExpensePending,
    },
    accounts: {
      openReceivable: Number(a.open_receivable),
      openPayable: Number(a.open_payable),
      overdueReceivable: Number(a.overdue_receivable),
      overduePayable: Number(a.overdue_payable),
      dueSoonReceivable: Number(a.due7_receivable),
      dueSoonPayable: Number(a.due7_payable),
    },
    delinquency: {
      total: Number(delinquency.rows[0]?.overdue_total ?? 0),
      count: Number(delinquency.rows[0]?.overdue_count ?? 0),
      openTotal: Number(delinquency.rows[0]?.open_total ?? 0),
      rate:
        Number(delinquency.rows[0]?.open_total ?? 0) > 0
          ? Math.round(
              (Number(delinquency.rows[0]?.overdue_total ?? 0) /
                Number(delinquency.rows[0]?.open_total ?? 1)) *
                1000,
            ) / 10
          : 0,
      top: topDelinquent.rows.map((r) => ({
        partyName: r.party_name,
        amount: Number(r.amount),
        dueAt: r.due_at,
        daysOverdue: Number(r.days_overdue),
      })),
    },
    expensesByCategory: expensesByCategory.rows.map((r) => ({
      category: r.category,
      amount: Number(r.amount),
    })),
    incomeByOrigin: incomeByOrigin.rows.map((r) => ({
      origin: r.origin,
      amount: Number(r.amount),
    })),
    balanceEvolution,
    comparison: {
      current: { income: curIncome, expense: curExpense, result: curResult },
      previous: { income: prevIncome, expense: prevExpense, result: prevResult },
      incomeDeltaPct: pct(curIncome, prevIncome),
      expenseDeltaPct: pct(curExpense, prevExpense),
      resultDeltaPct: pct(curResult, prevResult),
    },
    forecast: {
      days7: forecastBalance(Number(a.due7_receivable), Number(a.due7_payable)),
      days15: forecastBalance(Number(a.due15_receivable), Number(a.due15_payable)),
      days30: forecastBalance(Number(a.due30_receivable), Number(a.due30_payable)),
      in7: { receive: Number(a.due7_receivable), pay: Number(a.due7_payable) },
      in15: { receive: Number(a.due15_receivable), pay: Number(a.due15_payable) },
      in30: { receive: Number(a.due30_receivable), pay: Number(a.due30_payable) },
    },
  };
}

export const getFinanceDashboard = createServerFn({ method: "GET" })
  .validator(z.object({ periodDays: z.number().int().positive().max(90).optional() }).optional())
  .handler(async ({ data }) => getFinanceDashboardHandler({ periodDays: data?.periodDays }));

export const createFinancialEntry = createServerFn({ method: "POST" })
  .validator(
    z.object({
      type: z.enum(["income", "expense"]),
      description: z.string().min(1).max(200),
      category: z.string().min(1).max(80).default("Geral"),
      origin: z.string().max(40).optional(),
      amount: z.coerce.number().positive(),
      occurredAt: z.string().optional(),
      status: z.enum(["confirmed", "pending"]).default("confirmed"),
      bankAccountId: z.number().int().positive().nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const origin =
      data.origin?.trim() ||
      originFromCategory(data.category, null);

    return withTransaction(async (client) => {
      let bankId = data.bankAccountId ?? null;
      if (data.status === "confirmed" && !bankId) {
        const def = await client.query<{ id: number }>(
          `SELECT id FROM bank_accounts WHERE is_default = TRUE AND active = TRUE LIMIT 1`,
        );
        bankId = def.rows[0]?.id ?? null;
      }

      const result = await client.query<{ id: number }>(
        `INSERT INTO financial_entries
           (type, description, category, origin, amount, status, occurred_at, created_by, bank_account_id)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, NOW()),$8,$9)
         RETURNING id`,
        [
          data.type,
          data.description.trim(),
          data.category.trim(),
          origin,
          data.amount,
          data.status,
          data.occurredAt?.trim() || null,
          user.id,
          bankId,
        ],
      );

      if (data.status === "confirmed" && bankId) {
        const delta = data.type === "income" ? data.amount : -data.amount;
        await client.query(
          `UPDATE bank_accounts SET balance = balance + $1 WHERE id = $2`,
          [delta, bankId],
        );
      }

      return { id: result.rows[0]!.id };
    });
  });

export const confirmPendingEntry = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.number().int().positive(),
      bankAccountId: z.number().int().positive().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireUser();
    return withTransaction(async (client) => {
      const entry = await client.query<{
        id: number;
        type: "income" | "expense";
        amount: string;
        status: string;
        bank_account_id: number | null;
      }>(
        `SELECT id, type, amount::text, status, bank_account_id
         FROM financial_entries WHERE id = $1 FOR UPDATE`,
        [data.id],
      );
      const row = entry.rows[0];
      if (!row) throw new Error("Lançamento não encontrado.");
      if (row.status !== "pending") throw new Error("Lançamento não está pendente.");

      let bankId = data.bankAccountId ?? row.bank_account_id;
      if (!bankId) {
        const def = await client.query<{ id: number }>(
          `SELECT id FROM bank_accounts WHERE is_default = TRUE LIMIT 1`,
        );
        bankId = def.rows[0]?.id ?? null;
      }

      await client.query(
        `UPDATE financial_entries
         SET status = 'confirmed', bank_account_id = $1, occurred_at = NOW()
         WHERE id = $2`,
        [bankId, data.id],
      );

      if (bankId) {
        const delta = row.type === "income" ? Number(row.amount) : -Number(row.amount);
        await client.query(`UPDATE bank_accounts SET balance = balance + $1 WHERE id = $2`, [
          delta,
          bankId,
        ]);
      }
      return { ok: true as const };
    });
  });
