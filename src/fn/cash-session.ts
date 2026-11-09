import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { writeAudit } from "./audit";
import { verifySupervisorCredentials } from "./authorize";
import { query, withTransaction } from "./db";
import { canCloseAnySession, canDoCashMovement } from "./permissions";
import { requireUser } from "./require-user";

const REGISTER = "PDV-01";

export type CashSessionRow = {
  id: number;
  register_code: string;
  operator_id: number;
  operator_name: string;
  opened_at: string;
  opening_cash: string;
  opening_notes: string | null;
  status: "open" | "closed";
};

async function getOpenSessionForUser(userId: number) {
  const result = await query<CashSessionRow>(
    `SELECT s.id, s.register_code, s.operator_id, u.name AS operator_name,
            s.opened_at::text, s.opening_cash::text, s.opening_notes, s.status
     FROM cash_sessions s
     JOIN users u ON u.id = s.operator_id
     WHERE s.status = 'open' AND s.operator_id = $1
     LIMIT 1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

async function buildSessionPreview(session: CashSessionRow) {
  const totals = await query<{
    cash_sales: string;
    pix_sales: string;
    credit_sales: string;
    debit_sales: string;
    fiado_sales: string;
    sangrias: string;
    suprimentos: string;
    sales_count: string;
  }>(
    `SELECT
       COALESCE((SELECT SUM(p.amount) FROM payments p JOIN sales s ON s.id = p.sale_id
         WHERE s.session_id = $1 AND s.status = 'completed' AND p.method = 'cash'), 0)::text AS cash_sales,
       COALESCE((SELECT SUM(p.amount) FROM payments p JOIN sales s ON s.id = p.sale_id
         WHERE s.session_id = $1 AND s.status = 'completed' AND p.method = 'pix'), 0)::text AS pix_sales,
       COALESCE((SELECT SUM(p.amount) FROM payments p JOIN sales s ON s.id = p.sale_id
         WHERE s.session_id = $1 AND s.status = 'completed' AND p.method = 'credit'), 0)::text AS credit_sales,
       COALESCE((SELECT SUM(p.amount) FROM payments p JOIN sales s ON s.id = p.sale_id
         WHERE s.session_id = $1 AND s.status = 'completed' AND p.method = 'debit'), 0)::text AS debit_sales,
       COALESCE((SELECT SUM(p.amount) FROM payments p JOIN sales s ON s.id = p.sale_id
         WHERE s.session_id = $1 AND s.status = 'completed' AND p.method = 'fiado'), 0)::text AS fiado_sales,
       COALESCE((SELECT SUM(amount) FROM cash_movements WHERE session_id = $1 AND type = 'sangria'), 0)::text AS sangrias,
       COALESCE((SELECT SUM(amount) FROM cash_movements WHERE session_id = $1 AND type = 'suprimento'), 0)::text AS suprimentos,
       COALESCE((SELECT COUNT(*) FROM sales WHERE session_id = $1 AND status = 'completed'), 0)::text AS sales_count`,
    [session.id],
  );

  const t = totals.rows[0]!;
  const opening = Number(session.opening_cash);
  const cashSales = Number(t.cash_sales);
  const sangrias = Number(t.sangrias);
  const suprimentos = Number(t.suprimentos);
  const expectedCash = opening + cashSales + suprimentos - sangrias;

  const movements = await query<{
    id: number;
    type: string;
    amount: string;
    reason: string;
    created_at: string;
    created_by_name: string;
  }>(
    `SELECT m.id, m.type, m.amount::text, m.reason, m.created_at::text, u.name AS created_by_name
     FROM cash_movements m
     JOIN users u ON u.id = m.created_by
     WHERE m.session_id = $1
     ORDER BY m.created_at DESC`,
    [session.id],
  );

  return {
    session,
    salesCount: Number(t.sales_count),
    byMethod: {
      cash: cashSales,
      pix: Number(t.pix_sales),
      credit: Number(t.credit_sales),
      debit: Number(t.debit_sales),
      fiado: Number(t.fiado_sales),
    },
    sangrias,
    suprimentos,
    expectedCash,
    movements: movements.rows,
  };
}

export const getCurrentCashSession = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const session = await getOpenSessionForUser(user.id);
  return { session, user };
});

export const openCashSession = createServerFn({ method: "POST" })
  .validator(
    z.object({
      openingCash: z.coerce.number().min(0),
      notes: z.string().max(500).optional(),
      registerCode: z.string().max(32).default(REGISTER),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (await getOpenSessionForUser(user.id)) {
      throw new Error("Você já possui um caixa aberto.");
    }

    const openRegister = await query(
      `SELECT id FROM cash_sessions WHERE status = 'open' AND register_code = $1 LIMIT 1`,
      [data.registerCode],
    );
    if (openRegister.rows[0]) {
      throw new Error(`O caixa ${data.registerCode} já está aberto por outro operador.`);
    }

    const result = await query<{ id: number }>(
      `INSERT INTO cash_sessions (register_code, operator_id, opening_cash, opening_notes, status)
       VALUES ($1, $2, $3, $4, 'open')
       RETURNING id`,
      [data.registerCode, user.id, data.openingCash, data.notes?.trim() || null],
    );

    await writeAudit({
      userId: user.id,
      action: "cash_open",
      entityType: "cash_session",
      entityId: result.rows[0]!.id,
      details: { openingCash: data.openingCash, notes: data.notes ?? null },
    });

    return { id: result.rows[0]!.id };
  });

export const createCashMovement = createServerFn({ method: "POST" })
  .validator(
    z.object({
      type: z.enum(["sangria", "suprimento"]),
      amount: z.coerce.number().positive(),
      reason: z.string().min(2).max(500),
      authUsername: z.string().optional(),
      authPassword: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const session = await getOpenSessionForUser(user.id);
    if (!session) throw new Error("Abra o caixa antes de registrar sangria/suprimento.");

    let authorizedBy: number | null = null;
    if (!canDoCashMovement(user)) {
      if (!data.authUsername || !data.authPassword) {
        throw new Error("Sangria/suprimento exige autorização de supervisor.");
      }
      const auth = await verifySupervisorCredentials(data.authUsername, data.authPassword);
      authorizedBy = auth.id;
    } else {
      authorizedBy = user.id;
    }

    const result = await query<{ id: number }>(
      `INSERT INTO cash_movements (session_id, type, amount, reason, created_by, authorized_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [session.id, data.type, data.amount, data.reason.trim(), user.id, authorizedBy],
    );

    await writeAudit({
      userId: user.id,
      action: data.type,
      entityType: "cash_movement",
      entityId: result.rows[0]!.id,
      details: { amount: data.amount, reason: data.reason, authorizedBy },
    });

    return { id: result.rows[0]!.id };
  });

export const getCashSessionPreview = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const session = await getOpenSessionForUser(user.id);
  if (!session) throw new Error("Nenhum caixa aberto.");
  return buildSessionPreview(session);
});

export const closeCashSession = createServerFn({ method: "POST" })
  .validator(
    z.object({
      countedCash: z.coerce.number().min(0),
      notes: z.string().max(500).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const session = await getOpenSessionForUser(user.id);
    if (!session) throw new Error("Nenhum caixa aberto para fechar.");

    if (session.operator_id !== user.id && !canCloseAnySession(user)) {
      throw new Error("Sem permissão para fechar este caixa.");
    }

    const preview = await buildSessionPreview(session);
    const expected = preview.expectedCash;
    const variance = data.countedCash - expected;

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE cash_sessions
         SET status = 'closed',
             closed_at = NOW(),
             closing_cash_counted = $1,
             expected_cash = $2,
             cash_variance = $3,
             closing_notes = $4,
             closed_by = $5
         WHERE id = $6 AND status = 'open'`,
        [data.countedCash, expected, variance, data.notes?.trim() || null, user.id, session.id],
      );

      await writeAudit(
        {
          userId: user.id,
          action: "cash_close",
          entityType: "cash_session",
          entityId: session.id,
          details: {
            countedCash: data.countedCash,
            expectedCash: expected,
            variance,
            byMethod: preview.byMethod,
          },
        },
        client,
      );
    });

    return { expectedCash: expected, variance, countedCash: data.countedCash };
  });
