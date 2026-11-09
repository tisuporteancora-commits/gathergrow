import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query, withTransaction } from "./db";
import { getSessionUser } from "./session";
import { isSupervisorOrAbove } from "./permissions";
import { writeAudit } from "./audit";
import {
  applyStockMovement,
  reverseStockMovement,
  type MovementType,
} from "./stock-core";

async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new Error("Não autenticado.");
  return user;
}

const entryTypes = z.enum([
  "entry_manual",
  "entry_purchase",
  "entry_return_customer",
]);

const exitTypes = z.enum([
  "exit_loss",
  "exit_damage",
  "exit_internal",
  "exit_expiry",
  "exit_return_supplier",
]);

export type StockMovementRow = {
  id: number;
  product_id: number;
  product_name: string;
  product_barcode: string;
  warehouse_id: number;
  warehouse_name: string;
  direction: "in" | "out";
  movement_type: string;
  qty: string;
  balance_before: string;
  balance_after: string;
  unit_cost: string | null;
  total_cost: string | null;
  document_number: string | null;
  reason: string | null;
  notes: string | null;
  source_type: string | null;
  source_id: number | null;
  supplier_name: string | null;
  user_name: string | null;
  occurred_at: string;
  reversed_by: number | null;
  reverses_id: number | null;
};

export const stockEntry = createServerFn({ method: "POST" })
  .validator(
    z.object({
      productId: z.number().int().positive(),
      warehouseId: z.number().int().positive().optional(),
      movementType: entryTypes.default("entry_manual"),
      qty: z.coerce.number().positive(),
      unitCost: z.coerce.number().min(0).optional(),
      supplierId: z.number().int().positive().nullable().optional(),
      documentNumber: z.string().max(80).nullable().optional(),
      reason: z.string().max(500).optional(),
      notes: z.string().max(1000).nullable().optional(),
      occurredAt: z.string().nullable().optional(),
      updateCost: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return withTransaction(async (client) => {
      const applied = await applyStockMovement(client, {
        productId: data.productId,
        warehouseId: data.warehouseId,
        direction: "in",
        movementType: data.movementType as MovementType,
        qty: data.qty,
        unitCost: data.unitCost,
        supplierId: data.supplierId,
        documentNumber: data.documentNumber,
        reason: data.reason || "Entrada de mercadoria",
        notes: data.notes,
        occurredAt: data.occurredAt,
        userId: user.id,
        updateProductCost: data.updateCost ?? data.unitCost != null,
        sourceType: "stock_entry",
      });
      await writeAudit(
        {
          userId: user.id,
          action: "stock_entry",
          entityType: "stock_movement",
          entityId: applied.movementId,
          details: data,
        },
        client,
      );
      return applied;
    });
  });

export const stockExit = createServerFn({ method: "POST" })
  .validator(
    z.object({
      productId: z.number().int().positive(),
      warehouseId: z.number().int().positive().optional(),
      movementType: exitTypes.default("exit_loss"),
      qty: z.coerce.number().positive(),
      reason: z.string().min(1).max(500),
      notes: z.string().max(1000).nullable().optional(),
      documentNumber: z.string().max(80).nullable().optional(),
      supplierId: z.number().int().positive().nullable().optional(),
      occurredAt: z.string().nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return withTransaction(async (client) => {
      const applied = await applyStockMovement(client, {
        productId: data.productId,
        warehouseId: data.warehouseId,
        direction: "out",
        movementType: data.movementType as MovementType,
        qty: data.qty,
        reason: data.reason,
        notes: data.notes,
        documentNumber: data.documentNumber,
        supplierId: data.supplierId,
        occurredAt: data.occurredAt,
        userId: user.id,
        sourceType: "stock_exit",
      });
      await writeAudit(
        {
          userId: user.id,
          action: "stock_exit",
          entityType: "stock_movement",
          entityId: applied.movementId,
          details: data,
        },
        client,
      );
      return applied;
    });
  });

export const listStockMovements = createServerFn({ method: "GET" })
  .validator(
    z
      .object({
        productId: z.number().int().positive().optional(),
        warehouseId: z.number().int().positive().optional(),
        userId: z.number().int().positive().optional(),
        movementType: z.string().optional(),
        direction: z.enum(["in", "out"]).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().int().positive().max(500).optional(),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    await requireUser();
    const params: unknown[] = [];
    const where: string[] = [];

    if (data?.productId) {
      params.push(data.productId);
      where.push(`m.product_id = $${params.length}`);
    }
    if (data?.warehouseId) {
      params.push(data.warehouseId);
      where.push(`m.warehouse_id = $${params.length}`);
    }
    if (data?.userId) {
      params.push(data.userId);
      where.push(`m.user_id = $${params.length}`);
    }
    if (data?.movementType) {
      params.push(data.movementType);
      where.push(`m.movement_type = $${params.length}`);
    }
    if (data?.direction) {
      params.push(data.direction);
      where.push(`m.direction = $${params.length}`);
    }
    if (data?.from) {
      params.push(data.from);
      where.push(`m.occurred_at >= $${params.length}::timestamptz`);
    }
    if (data?.to) {
      params.push(data.to);
      where.push(`m.occurred_at <= $${params.length}::timestamptz`);
    }

    params.push(data?.limit ?? 200);
    const result = await query<StockMovementRow>(
      `SELECT m.id, m.product_id, p.name AS product_name, p.barcode AS product_barcode,
              m.warehouse_id, w.name AS warehouse_name,
              m.direction, m.movement_type, m.qty::text,
              m.balance_before::text, m.balance_after::text,
              m.unit_cost::text, m.total_cost::text,
              m.document_number, m.reason, m.notes,
              m.source_type, m.source_id,
              s.name AS supplier_name, u.name AS user_name,
              m.occurred_at::text, m.reversed_by, m.reverses_id
       FROM stock_movements m
       JOIN products p ON p.id = m.product_id
       JOIN warehouses w ON w.id = m.warehouse_id
       LEFT JOIN suppliers s ON s.id = m.supplier_id
       LEFT JOIN users u ON u.id = m.user_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY m.occurred_at DESC, m.id DESC
       LIMIT $${params.length}`,
      params,
    );
    return result.rows;
  });

export const reverseMovement = createServerFn({ method: "POST" })
  .validator(
    z.object({
      movementId: z.number().int().positive(),
      reason: z.string().min(3).max(500),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (!isSupervisorOrAbove(user)) {
      throw new Error("Apenas supervisor ou admin pode estornar movimentações.");
    }
    return withTransaction(async (client) => {
      const applied = await reverseStockMovement(client, {
        movementId: data.movementId,
        userId: user.id,
        authorizedBy: user.id,
        reason: data.reason,
      });
      await writeAudit(
        {
          userId: user.id,
          action: "stock_reversal",
          entityType: "stock_movement",
          entityId: applied.movementId,
          details: { reverses: data.movementId, reason: data.reason },
        },
        client,
      );
      return applied;
    });
  });

export type StockAlertRow = {
  id: number;
  barcode: string;
  name: string;
  unit: string;
  stock_qty: string;
  min_stock: string;
  max_stock: string;
  expires_at: string | null;
  last_movement_at: string | null;
  alert_kind: "below_min" | "zero" | "near_expiry" | "stagnant" | "reorder";
  suggestion_qty: string;
};

export const listStockAlerts = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  const settings = await query<{ stagnant_days: number; near_expiry_days: number }>(
    `SELECT stagnant_days, near_expiry_days FROM stock_settings WHERE id = 1`,
  );
  const stagnantDays = settings.rows[0]?.stagnant_days ?? 90;
  const nearExpiryDays = settings.rows[0]?.near_expiry_days ?? 30;

  const result = await query<StockAlertRow>(
    `SELECT * FROM (
       SELECT p.id, p.barcode, p.name, p.unit,
              p.stock_qty::text, p.min_stock::text, p.max_stock::text,
              p.expires_at::text, p.last_movement_at::text,
              CASE
                WHEN p.stock_qty <= 0 THEN 'zero'
                WHEN p.stock_qty <= p.min_stock THEN 'below_min'
                WHEN p.expires_at IS NOT NULL
                     AND p.expires_at <= CURRENT_DATE + ($1 || ' days')::interval
                     AND p.expires_at >= CURRENT_DATE THEN 'near_expiry'
                WHEN COALESCE(p.last_movement_at, p.created_at) < NOW() - ($2 || ' days')::interval
                     AND p.stock_qty > 0 THEN 'stagnant'
                WHEN p.max_stock > 0 AND p.stock_qty < p.max_stock * 0.3 AND p.stock_qty <= p.min_stock
                     THEN 'reorder'
                ELSE NULL
              END AS alert_kind,
              GREATEST(COALESCE(NULLIF(p.max_stock, 0), p.min_stock * 2) - p.stock_qty, 0)::text AS suggestion_qty
       FROM products p
       WHERE p.active = TRUE
     ) t
     WHERE alert_kind IS NOT NULL
     ORDER BY
       CASE alert_kind
         WHEN 'zero' THEN 0
         WHEN 'below_min' THEN 1
         WHEN 'near_expiry' THEN 2
         WHEN 'reorder' THEN 3
         ELSE 4
       END,
       name ASC
     LIMIT 300`,
    [nearExpiryDays, stagnantDays],
  );
  return result.rows;
});

export const createInventoryCount = createServerFn({ method: "POST" })
  .validator(
    z.object({
      warehouseId: z.number().int().positive(),
      categoryId: z.number().int().positive().nullable().optional(),
      notes: z.string().max(1000).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return withTransaction(async (client) => {
      const code = `INV-${Date.now().toString(36).toUpperCase()}`;
      const inv = await client.query<{ id: number }>(
        `INSERT INTO inventory_counts
           (code, warehouse_id, category_id, status, notes, created_by)
         VALUES ($1,$2,$3,'counting',$4,$5)
         RETURNING id`,
        [code, data.warehouseId, data.categoryId ?? null, data.notes ?? null, user.id],
      );
      const countId = inv.rows[0]!.id;

      const params: unknown[] = [data.warehouseId];
      let catFilter = "";
      if (data.categoryId) {
        params.push(data.categoryId);
        catFilter = `AND p.category_id = $${params.length}`;
      }

      await client.query(
        `INSERT INTO inventory_count_items (count_id, product_id, system_qty, counted_qty, variance)
         SELECT $1, p.id, COALESCE(ws.qty, 0), NULL, NULL
         FROM products p
         LEFT JOIN warehouse_stock ws
           ON ws.product_id = p.id AND ws.warehouse_id = $2
         WHERE p.active = TRUE ${catFilter}`,
        [countId, ...params],
      );

      return { id: countId, code };
    });
  });

export const listInventoryCounts = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  const result = await query<{
    id: number;
    code: string;
    warehouse_name: string;
    category_name: string | null;
    status: string;
    notes: string | null;
    created_by_name: string | null;
    approved_by_name: string | null;
    created_at: string;
    item_count: string;
  }>(
    `SELECT ic.id, ic.code, w.name AS warehouse_name, c.name AS category_name,
            ic.status, ic.notes, u.name AS created_by_name, a.name AS approved_by_name,
            ic.created_at::text,
            (SELECT COUNT(*)::text FROM inventory_count_items i WHERE i.count_id = ic.id) AS item_count
     FROM inventory_counts ic
     JOIN warehouses w ON w.id = ic.warehouse_id
     LEFT JOIN categories c ON c.id = ic.category_id
     LEFT JOIN users u ON u.id = ic.created_by
     LEFT JOIN users a ON a.id = ic.approved_by
     ORDER BY ic.created_at DESC
     LIMIT 100`,
  );
  return result.rows;
});

export const getInventoryCount = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    await requireUser();
    const header = await query<{
      id: number;
      code: string;
      warehouse_id: number;
      warehouse_name: string;
      status: string;
      notes: string | null;
    }>(
      `SELECT ic.id, ic.code, ic.warehouse_id, w.name AS warehouse_name, ic.status, ic.notes
       FROM inventory_counts ic
       JOIN warehouses w ON w.id = ic.warehouse_id
       WHERE ic.id = $1`,
      [data.id],
    );
    if (!header.rows[0]) throw new Error("Inventário não encontrado.");

    const items = await query<{
      id: number;
      product_id: number;
      product_name: string;
      barcode: string;
      system_qty: string;
      counted_qty: string | null;
      variance: string | null;
      notes: string | null;
    }>(
      `SELECT i.id, i.product_id, p.name AS product_name, p.barcode,
              i.system_qty::text, i.counted_qty::text, i.variance::text, i.notes
       FROM inventory_count_items i
       JOIN products p ON p.id = i.product_id
       WHERE i.count_id = $1
       ORDER BY p.name ASC`,
      [data.id],
    );
    return { ...header.rows[0], items: items.rows };
  });

export const saveInventoryCounts = createServerFn({ method: "POST" })
  .validator(
    z.object({
      countId: z.number().int().positive(),
      items: z.array(
        z.object({
          itemId: z.number().int().positive(),
          countedQty: z.coerce.number().min(0),
          notes: z.string().max(500).nullable().optional(),
        }),
      ),
    }),
  )
  .handler(async ({ data }) => {
    await requireUser();
    return withTransaction(async (client) => {
      const inv = await client.query<{ status: string }>(
        `SELECT status FROM inventory_counts WHERE id = $1 FOR UPDATE`,
        [data.countId],
      );
      if (!inv.rows[0]) throw new Error("Inventário não encontrado.");
      if (!["draft", "counting", "pending_approval"].includes(inv.rows[0].status)) {
        throw new Error("Inventário não pode mais ser editado.");
      }

      for (const item of data.items) {
        await client.query(
          `UPDATE inventory_count_items
           SET counted_qty = $1,
               variance = $1 - system_qty,
               notes = $2
           WHERE id = $3 AND count_id = $4`,
          [item.countedQty, item.notes ?? null, item.itemId, data.countId],
        );
      }

      await client.query(
        `UPDATE inventory_counts SET status = 'pending_approval' WHERE id = $1`,
        [data.countId],
      );
      return { ok: true };
    });
  });

export const approveInventoryCount = createServerFn({ method: "POST" })
  .validator(
    z.object({
      countId: z.number().int().positive(),
      justification: z.string().min(3).max(500),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (!isSupervisorOrAbove(user)) {
      throw new Error("Apenas supervisor ou admin pode aprovar inventário.");
    }

    return withTransaction(async (client) => {
      const inv = await client.query<{
        id: number;
        warehouse_id: number;
        status: string;
      }>(`SELECT id, warehouse_id, status FROM inventory_counts WHERE id = $1 FOR UPDATE`, [
        data.countId,
      ]);
      const header = inv.rows[0];
      if (!header) throw new Error("Inventário não encontrado.");
      if (header.status === "approved") throw new Error("Inventário já aprovado.");
      if (header.status === "cancelled") throw new Error("Inventário cancelado.");

      const items = await client.query<{
        product_id: number;
        system_qty: string;
        counted_qty: string | null;
      }>(
        `SELECT product_id, system_qty::text, counted_qty::text
         FROM inventory_count_items WHERE count_id = $1`,
        [data.countId],
      );

      for (const item of items.rows) {
        if (item.counted_qty == null) continue;
        const counted = Number(item.counted_qty);
        const system = Number(item.system_qty);
        const diff = counted - system;
        if (Math.abs(diff) < 1e-9) continue;

        await applyStockMovement(client, {
          productId: item.product_id,
          warehouseId: header.warehouse_id,
          direction: diff > 0 ? "in" : "out",
          movementType: diff > 0 ? "entry_inventory" : "exit_inventory",
          qty: Math.abs(diff),
          reason: data.justification,
          notes: `Ajuste de inventário #${data.countId}`,
          userId: user.id,
          authorizedBy: user.id,
          sourceType: "inventory",
          sourceId: data.countId,
          allowNegative: true,
        });
      }

      await client.query(
        `UPDATE inventory_counts
         SET status = 'approved', approved_by = $1, approved_at = NOW(), notes = COALESCE(notes,'') || $2
         WHERE id = $3`,
        [user.id, `\nAprovado: ${data.justification}`, data.countId],
      );

      await writeAudit(
        {
          userId: user.id,
          action: "inventory_approve",
          entityType: "inventory_count",
          entityId: data.countId,
          details: { justification: data.justification },
        },
        client,
      );
      return { ok: true };
    });
  });
