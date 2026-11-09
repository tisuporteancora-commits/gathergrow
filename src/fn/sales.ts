import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { writeAudit } from "./audit";
import { verifySupervisorCredentials } from "./authorize";
import { query, withTransaction } from "./db";
import {
  canApplyItemDiscount,
  canApplySaleDiscount,
  canCancelSale,
  canManageFiado,
} from "./permissions";
import { requireUser } from "./require-user";
import { applyStockMovement } from "./stock-core";

const cartItemSchema = z.object({
  productId: z.number().int().positive(),
  qty: z.number().positive(),
  unitPrice: z.number().min(0),
  discount: z.number().min(0).default(0),
});

const paymentSchema = z.object({
  method: z.enum(["cash", "pix", "credit", "debit", "fiado"]),
  amount: z.number().positive(),
  receivedAmount: z.number().min(0).optional(),
});

const METHOD_LABEL = {
  cash: "Dinheiro",
  pix: "PIX",
  credit: "Cartão crédito",
  debit: "Cartão débito",
  fiado: "Fiado",
} as const;

async function requireOpenSession(userId: number) {
  const result = await query<{ id: number; register_code: string }>(
    `SELECT id, register_code FROM cash_sessions
     WHERE status = 'open' AND operator_id = $1 LIMIT 1`,
    [userId],
  );
  const session = result.rows[0];
  if (!session) throw new Error("Abra o caixa antes de vender.");
  return session;
}

export const completeSale = createServerFn({ method: "POST" })
  .validator(
    z.object({
      items: z.array(cartItemSchema).min(1),
      saleDiscount: z.number().min(0).default(0),
      surcharge: z.number().min(0).default(0),
      payments: z.array(paymentSchema).min(1),
      customerId: z.number().int().positive().nullable().optional(),
      notes: z.string().max(500).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const session = await requireOpenSession(user.id);

    const hasItemDiscount = data.items.some((i) => i.discount > 0);
    if (hasItemDiscount && !canApplyItemDiscount(user)) {
      throw new Error("Sem permissão para desconto por item.");
    }
    if (data.saleDiscount > 0 && !canApplySaleDiscount(user)) {
      throw new Error("Desconto geral exige perfil supervisor/admin.");
    }

    const hasFiado = data.payments.some((p) => p.method === "fiado");
    if (hasFiado) {
      if (!canManageFiado(user)) throw new Error("Sem permissão para fiado.");
      if (!data.customerId) throw new Error("Fiado exige cliente cadastrado.");
    }

    for (const item of data.items) {
      const gross = item.qty * item.unitPrice;
      if (item.discount > gross + 0.001) {
        throw new Error("Desconto do item maior que o valor da linha.");
      }
    }

    const itemsNet = data.items.reduce(
      (sum, item) => sum + item.qty * item.unitPrice - item.discount,
      0,
    );
    const itemDiscounts = data.items.reduce((sum, item) => sum + item.discount, 0);
    const totalDiscount = itemDiscounts + data.saleDiscount;
    const total = Math.max(0, itemsNet - data.saleDiscount + data.surcharge);
    const grossSubtotal = data.items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);

    const paid = data.payments.reduce((sum, p) => sum + p.amount, 0);
    if (Math.abs(paid - total) > 0.02) {
      throw new Error(
        `Soma dos pagamentos (${paid.toFixed(2)}) diferente do total (${total.toFixed(2)}).`,
      );
    }

    for (const payment of data.payments) {
      if (payment.method === "cash") {
        const received = payment.receivedAmount ?? payment.amount;
        if (received + 0.001 < payment.amount) {
          throw new Error("Valor recebido em dinheiro insuficiente.");
        }
      }
    }

    if (hasFiado && data.customerId) {
      const cust = await query<{
        name: string;
        credit_limit: string;
        open_balance: string;
      }>(
        `SELECT c.name, c.credit_limit::text,
                COALESCE((
                  SELECT SUM(a.amount) FROM accounts a
                  WHERE a.direction = 'receivable' AND a.status IN ('open','overdue')
                    AND a.party_name = c.name
                ), 0)::text AS open_balance
         FROM customers c WHERE c.id = $1 AND c.active`,
        [data.customerId],
      );
      const c = cust.rows[0];
      if (!c) throw new Error("Cliente não encontrado.");
      const fiadoAmount = data.payments
        .filter((p) => p.method === "fiado")
        .reduce((s, p) => s + p.amount, 0);
      const limit = Number(c.credit_limit);
      const open = Number(c.open_balance);
      if (limit > 0 && open + fiadoAmount > limit + 0.001) {
        throw new Error(
          `Limite de crédito excedido. Disponível: R$ ${(limit - open).toFixed(2)}.`,
        );
      }
    }

    return withTransaction(async (client) => {
      await client.query(
        `ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS discount NUMERIC(12, 2) NOT NULL DEFAULT 0`,
      );

      for (const item of data.items) {
        const stock = await client.query<{ stock_qty: string; name: string }>(
          `SELECT stock_qty::text, name FROM products WHERE id = $1 FOR UPDATE`,
          [item.productId],
        );
        const row = stock.rows[0];
        if (!row) throw new Error(`Produto #${item.productId} não encontrado.`);
        if (Number(row.stock_qty) + 1e-9 < item.qty) {
          throw new Error(`Estoque insuficiente para "${row.name}".`);
        }
      }

      const code = `TX-${Date.now().toString(36).toUpperCase()}`;
      const saleResult = await client.query<{ id: number }>(
        `INSERT INTO sales
           (code, operator_id, session_id, customer_id, subtotal, discount, surcharge, total, notes, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'completed')
         RETURNING id`,
        [
          code,
          user.id,
          session.id,
          data.customerId ?? null,
          grossSubtotal,
          totalDiscount,
          data.surcharge,
          total,
          data.notes?.trim() || null,
        ],
      );
      const saleId = saleResult.rows[0]!.id;

      for (const item of data.items) {
        const lineTotal = Math.max(0, item.qty * item.unitPrice - item.discount);
        await client.query(
          `INSERT INTO sale_items (sale_id, product_id, qty, unit_price, discount, line_total)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [saleId, item.productId, item.qty, item.unitPrice, item.discount, lineTotal],
        );
        await applyStockMovement(client, {
          productId: item.productId,
          direction: "out",
          movementType: "exit_sale",
          qty: item.qty,
          reason: `Venda ${code}`,
          userId: user.id,
          sourceType: "sale",
          sourceId: saleId,
        });
      }

      let totalChange = 0;
      let customerName: string | null = null;
      if (data.customerId) {
        const cn = await client.query<{ name: string }>(
          `SELECT name FROM customers WHERE id = $1`,
          [data.customerId],
        );
        customerName = cn.rows[0]?.name ?? null;
      }

      for (const payment of data.payments) {
        const received =
          payment.method === "cash" ? (payment.receivedAmount ?? payment.amount) : payment.amount;
        const change =
          payment.method === "cash" ? Math.max(0, received - payment.amount) : 0;
        totalChange += change;
        await client.query(
          `INSERT INTO payments (sale_id, method, amount, received_amount, change_amount)
           VALUES ($1,$2,$3,$4,$5)`,
          [saleId, payment.method, payment.amount, received, change],
        );

        if (payment.method === "fiado" && customerName) {
          await client.query(
            `INSERT INTO accounts
               (direction, party_name, account_kind, document_code, description, amount, due_at, status, created_by)
             VALUES ('receivable', $1, 'fiado', $2, $3, $4, CURRENT_DATE + INTERVAL '30 days', 'open', $5)`,
            [
              customerName,
              code,
              `Fiado venda ${code}`,
              payment.amount,
              user.id,
            ],
          );
        }
      }

      const methodsLabel = data.payments
        .map((p) => `${METHOD_LABEL[p.method]} ${p.amount.toFixed(2)}`)
        .join(" + ");

      const defaultBank = await client.query<{ id: number }>(
        `SELECT id FROM bank_accounts WHERE is_default = TRUE AND active = TRUE LIMIT 1`,
      );
      const bankId = defaultBank.rows[0]?.id ?? null;
      await client.query(
        `INSERT INTO financial_entries
           (type, description, category, origin, amount, status, occurred_at, sale_id, created_by, bank_account_id)
         VALUES ('income', $1, 'Vendas PDV', 'PDV', $2, 'confirmed', NOW(), $3, $4, $5)`,
        [`Venda ${code} (${methodsLabel})`, total, saleId, user.id, bankId],
      );
      if (bankId) {
        await client.query(`UPDATE bank_accounts SET balance = balance + $1 WHERE id = $2`, [
          total,
          bankId,
        ]);
      }

      await writeAudit(
        {
          userId: user.id,
          action: "sale_complete",
          entityType: "sale",
          entityId: saleId,
          details: { code, total, payments: data.payments, customerId: data.customerId ?? null },
        },
        client,
      );

      return { id: saleId, code, total, change: totalChange, sessionId: session.id };
    });
  });

export const listSales = createServerFn({ method: "GET" })
  .validator(
    z
      .object({
        q: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        operatorId: z.number().int().positive().optional(),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    await requireUser();
    const params: unknown[] = [];
    const where: string[] = ["1=1"];

    if (data?.q?.trim()) {
      params.push(`%${data.q.trim()}%`);
      where.push(`(s.code ILIKE $${params.length} OR COALESCE(c.name,'') ILIKE $${params.length})`);
    }
    if (data?.from) {
      params.push(data.from);
      where.push(`s.created_at::date >= $${params.length}::date`);
    }
    if (data?.to) {
      params.push(data.to);
      where.push(`s.created_at::date <= $${params.length}::date`);
    }
    if (data?.operatorId) {
      params.push(data.operatorId);
      where.push(`s.operator_id = $${params.length}`);
    }

    const result = await query<{
      id: number;
      code: string;
      created_at: string;
      operator_name: string;
      customer_name: string | null;
      total: string;
      status: string;
    }>(
      `SELECT s.id, s.code, s.created_at::text, u.name AS operator_name,
              c.name AS customer_name, s.total::text, s.status
       FROM sales s
       JOIN users u ON u.id = s.operator_id
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE ${where.join(" AND ")}
       ORDER BY s.created_at DESC
       LIMIT 100`,
      params,
    );
    return result.rows;
  });

export const getSaleDetail = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    await requireUser();
    const sale = await query<{
      id: number;
      code: string;
      created_at: string;
      operator_name: string;
      customer_name: string | null;
      subtotal: string;
      discount: string;
      total: string;
      status: string;
      notes: string | null;
      cancel_reason: string | null;
    }>(
      `SELECT s.id, s.code, s.created_at::text, u.name AS operator_name, c.name AS customer_name,
              s.subtotal::text, s.discount::text, s.total::text, s.status, s.notes, s.cancel_reason
       FROM sales s
       JOIN users u ON u.id = s.operator_id
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.id = $1`,
      [data.id],
    );
    const row = sale.rows[0];
    if (!row) throw new Error("Venda não encontrada.");

    const items = await query<{
      name: string;
      qty: string;
      unit_price: string;
      discount: string;
      line_total: string;
    }>(
      `SELECT p.name, si.qty::text, si.unit_price::text, si.discount::text, si.line_total::text
       FROM sale_items si
       JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = $1`,
      [data.id],
    );

    const payments = await query<{
      method: string;
      amount: string;
      received_amount: string | null;
      change_amount: string | null;
    }>(
      `SELECT method, amount::text, received_amount::text, change_amount::text
       FROM payments WHERE sale_id = $1`,
      [data.id],
    );

    return { sale: row, items: items.rows, payments: payments.rows };
  });

export const cancelSale = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.number().int().positive(),
      reason: z.string().min(3).max(500),
      authUsername: z.string().optional(),
      authPassword: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    let actor = user;
    if (!canCancelSale(user)) {
      if (!data.authUsername || !data.authPassword) {
        throw new Error("Cancelamento exige autorização de supervisor.");
      }
      actor = await verifySupervisorCredentials(data.authUsername, data.authPassword);
    }

    return withTransaction(async (client) => {
      const sale = await client.query<{
        id: number;
        code: string;
        status: string;
        total: string;
        session_id: number | null;
      }>(`SELECT id, code, status, total::text, session_id FROM sales WHERE id = $1 FOR UPDATE`, [
        data.id,
      ]);
      const row = sale.rows[0];
      if (!row) throw new Error("Venda não encontrada.");
      if (row.status !== "completed") throw new Error("Somente vendas concluídas podem ser canceladas.");

      if (row.session_id) {
        const sess = await client.query<{ status: string }>(
          `SELECT status FROM cash_sessions WHERE id = $1`,
          [row.session_id],
        );
        if (sess.rows[0]?.status === "closed") {
          throw new Error("Não é possível cancelar venda de caixa já fechado.");
        }
      }

      const items = await client.query<{ product_id: number; qty: string }>(
        `SELECT product_id, qty::text FROM sale_items WHERE sale_id = $1`,
        [data.id],
      );
      for (const item of items.rows) {
        await applyStockMovement(client, {
          productId: item.product_id,
          direction: "in",
          movementType: "entry_return_customer",
          qty: Number(item.qty),
          reason: `Estorno venda ${row.code}`,
          userId: actor.id,
          sourceType: "sale_cancel",
          sourceId: data.id,
          allowNegative: true,
        });
      }

      await client.query(
        `UPDATE sales
         SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = $1, cancelled_by = $2
         WHERE id = $3`,
        [data.reason.trim(), actor.id, data.id],
      );

      // Soft-cancel linked financial entry and reverte saldo bancário
      const fin = await client.query<{ amount: string; bank_account_id: number | null }>(
        `SELECT amount::text, bank_account_id FROM financial_entries
         WHERE sale_id = $1 AND status = 'confirmed'`,
        [data.id],
      );
      for (const fe of fin.rows) {
        if (fe.bank_account_id) {
          await client.query(
            `UPDATE bank_accounts SET balance = balance - $1 WHERE id = $2`,
            [Number(fe.amount), fe.bank_account_id],
          );
        }
      }
      await client.query(
        `UPDATE financial_entries SET status = 'cancelled'
         WHERE sale_id = $1 AND status = 'confirmed'`,
        [data.id],
      );

      await client.query(
        `UPDATE accounts SET status = 'cancelled'
         WHERE document_code = $1 AND account_kind = 'fiado' AND status IN ('open','overdue')`,
        [row.code],
      );

      await writeAudit(
        {
          userId: user.id,
          action: "sale_cancel",
          entityType: "sale",
          entityId: data.id,
          details: {
            reason: data.reason,
            authorizedBy: actor.id,
            code: row.code,
            total: row.total,
          },
        },
        client,
      );

      return { ok: true as const };
    });
  });
