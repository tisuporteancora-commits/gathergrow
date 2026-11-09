import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query, withTransaction } from "./db";
import { getSessionUser } from "./session";
import { applyStockMovement } from "./stock-core";
import { writeAudit } from "./audit";

async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new Error("Não autenticado.");
  return user;
}

export type WarehouseRow = {
  id: number;
  code: string;
  name: string;
  kind: string;
  active: boolean;
  is_default: boolean;
};

export const listWarehouses = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  const result = await query<WarehouseRow>(
    `SELECT id, code, name, kind, active, is_default
     FROM warehouses
     WHERE active = TRUE
     ORDER BY is_default DESC, name ASC`,
  );
  return result.rows;
});

export const upsertWarehouse = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.number().int().positive().optional(),
      code: z.string().min(1).max(32),
      name: z.string().min(1).max(120),
      kind: z.enum(["store", "deposit", "branch"]).default("deposit"),
      isDefault: z.boolean().optional(),
      active: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireUser();
    return withTransaction(async (client) => {
      if (data.isDefault) {
        await client.query(`UPDATE warehouses SET is_default = FALSE WHERE is_default = TRUE`);
      }

      if (data.id) {
        const result = await client.query<{ id: number }>(
          `UPDATE warehouses SET
             code=$1, name=$2, kind=$3,
             is_default=COALESCE($4, is_default),
             active=COALESCE($5, active)
           WHERE id=$6 RETURNING id`,
          [
            data.code.trim().toUpperCase(),
            data.name.trim(),
            data.kind,
            data.isDefault,
            data.active,
            data.id,
          ],
        );
        if (!result.rows[0]) throw new Error("Depósito não encontrado.");
        return { id: result.rows[0].id };
      }

      const result = await client.query<{ id: number }>(
        `INSERT INTO warehouses (code, name, kind, is_default)
         VALUES ($1,$2,$3,COALESCE($4,FALSE))
         RETURNING id`,
        [data.code.trim().toUpperCase(), data.name.trim(), data.kind, data.isDefault ?? false],
      );
      return { id: result.rows[0]!.id };
    });
  });

export const listWarehouseBalances = createServerFn({ method: "GET" })
  .validator(
    z
      .object({
        warehouseId: z.number().int().positive().optional(),
        productId: z.number().int().positive().optional(),
        search: z.string().optional(),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    await requireUser();
    const params: unknown[] = [];
    const where: string[] = ["p.active = TRUE"];

    if (data?.warehouseId) {
      params.push(data.warehouseId);
      where.push(`ws.warehouse_id = $${params.length}`);
    }
    if (data?.productId) {
      params.push(data.productId);
      where.push(`ws.product_id = $${params.length}`);
    }
    if (data?.search?.trim()) {
      params.push(`%${data.search.trim()}%`);
      where.push(
        `(p.name ILIKE $${params.length} OR p.barcode ILIKE $${params.length})`,
      );
    }

    const result = await query<{
      warehouse_id: number;
      warehouse_name: string;
      product_id: number;
      product_name: string;
      barcode: string;
      qty: string;
      total_qty: string;
    }>(
      `SELECT ws.warehouse_id, w.name AS warehouse_name,
              ws.product_id, p.name AS product_name, p.barcode,
              ws.qty::text, p.stock_qty::text AS total_qty
       FROM warehouse_stock ws
       JOIN warehouses w ON w.id = ws.warehouse_id
       JOIN products p ON p.id = ws.product_id
       WHERE ${where.join(" AND ")} AND ws.qty <> 0
       ORDER BY w.name, p.name
       LIMIT 400`,
      params,
    );
    return result.rows;
  });

export const createTransfer = createServerFn({ method: "POST" })
  .validator(
    z.object({
      fromWarehouseId: z.number().int().positive(),
      toWarehouseId: z.number().int().positive(),
      notes: z.string().max(1000).nullable().optional(),
      items: z
        .array(
          z.object({
            productId: z.number().int().positive(),
            qty: z.coerce.number().positive(),
          }),
        )
        .min(1),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (data.fromWarehouseId === data.toWarehouseId) {
      throw new Error("Depósitos de origem e destino devem ser diferentes.");
    }

    return withTransaction(async (client) => {
      const code = `TR-${Date.now().toString(36).toUpperCase()}`;
      const tr = await client.query<{ id: number }>(
        `INSERT INTO stock_transfers
           (code, from_warehouse_id, to_warehouse_id, status, notes, shipped_at, created_by)
         VALUES ($1,$2,$3,'shipped',$4,NOW(),$5)
         RETURNING id`,
        [
          code,
          data.fromWarehouseId,
          data.toWarehouseId,
          data.notes || null,
          user.id,
        ],
      );
      const transferId = tr.rows[0]!.id;

      for (const item of data.items) {
        await client.query(
          `INSERT INTO stock_transfer_items (transfer_id, product_id, qty_sent)
           VALUES ($1,$2,$3)`,
          [transferId, item.productId, item.qty],
        );

        await applyStockMovement(client, {
          productId: item.productId,
          warehouseId: data.fromWarehouseId,
          direction: "out",
          movementType: "exit_transfer",
          qty: item.qty,
          reason: `Transferência ${code} (envio)`,
          userId: user.id,
          transferId,
          sourceType: "transfer",
          sourceId: transferId,
        });
      }

      return { id: transferId, code };
    });
  });

export const listTransfers = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  const result = await query<{
    id: number;
    code: string;
    from_name: string;
    to_name: string;
    status: string;
    notes: string | null;
    created_at: string;
    shipped_at: string | null;
    received_at: string | null;
  }>(
    `SELECT t.id, t.code, f.name AS from_name, d.name AS to_name,
            t.status, t.notes, t.created_at::text, t.shipped_at::text, t.received_at::text
     FROM stock_transfers t
     JOIN warehouses f ON f.id = t.from_warehouse_id
     JOIN warehouses d ON d.id = t.to_warehouse_id
     ORDER BY t.created_at DESC
     LIMIT 100`,
  );
  return result.rows;
});

export const getTransfer = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    await requireUser();
    const header = await query<{
      id: number;
      code: string;
      from_warehouse_id: number;
      to_warehouse_id: number;
      from_name: string;
      to_name: string;
      status: string;
      notes: string | null;
    }>(
      `SELECT t.id, t.code, t.from_warehouse_id, t.to_warehouse_id,
              f.name AS from_name, d.name AS to_name, t.status, t.notes
       FROM stock_transfers t
       JOIN warehouses f ON f.id = t.from_warehouse_id
       JOIN warehouses d ON d.id = t.to_warehouse_id
       WHERE t.id = $1`,
      [data.id],
    );
    if (!header.rows[0]) throw new Error("Transferência não encontrada.");
    const items = await query<{
      id: number;
      product_id: number;
      product_name: string;
      barcode: string;
      qty_sent: string;
      qty_received: string | null;
      notes: string | null;
    }>(
      `SELECT i.id, i.product_id, p.name AS product_name, p.barcode,
              i.qty_sent::text, i.qty_received::text, i.notes
       FROM stock_transfer_items i
       JOIN products p ON p.id = i.product_id
       WHERE i.transfer_id = $1`,
      [data.id],
    );
    return { ...header.rows[0], items: items.rows };
  });

export const receiveTransfer = createServerFn({ method: "POST" })
  .validator(
    z.object({
      transferId: z.number().int().positive(),
      items: z.array(
        z.object({
          itemId: z.number().int().positive(),
          qtyReceived: z.coerce.number().min(0),
          notes: z.string().max(500).nullable().optional(),
        }),
      ),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return withTransaction(async (client) => {
      const tr = await client.query<{
        id: number;
        code: string;
        to_warehouse_id: number;
        status: string;
      }>(
        `SELECT id, code, to_warehouse_id, status
         FROM stock_transfers WHERE id = $1 FOR UPDATE`,
        [data.transferId],
      );
      const transfer = tr.rows[0];
      if (!transfer) throw new Error("Transferência não encontrada.");
      if (transfer.status === "received") throw new Error("Já recebida.");
      if (transfer.status === "cancelled") throw new Error("Transferência cancelada.");

      let diverged = false;

      for (const recv of data.items) {
        const item = await client.query<{
          id: number;
          product_id: number;
          qty_sent: string;
        }>(
          `SELECT id, product_id, qty_sent::text
           FROM stock_transfer_items WHERE id = $1 AND transfer_id = $2 FOR UPDATE`,
          [recv.itemId, data.transferId],
        );
        const row = item.rows[0];
        if (!row) continue;

        const sent = Number(row.qty_sent);
        const received = recv.qtyReceived;
        if (Math.abs(sent - received) > 1e-9) diverged = true;

        await client.query(
          `UPDATE stock_transfer_items
           SET qty_received = $1, notes = $2
           WHERE id = $3`,
          [received, recv.notes ?? null, row.id],
        );

        if (received > 0) {
          await applyStockMovement(client, {
            productId: row.product_id,
            warehouseId: transfer.to_warehouse_id,
            direction: "in",
            movementType: "entry_transfer",
            qty: received,
            reason: `Transferência ${transfer.code} (recebimento)`,
            notes: recv.notes,
            userId: user.id,
            transferId: transfer.id,
            sourceType: "transfer",
            sourceId: transfer.id,
          });
        }
      }

      await client.query(
        `UPDATE stock_transfers
         SET status = $1, received_at = NOW(), received_by = $2
         WHERE id = $3`,
        [diverged ? "diverged" : "received", user.id, data.transferId],
      );

      await writeAudit(
        {
          userId: user.id,
          action: "transfer_receive",
          entityType: "stock_transfer",
          entityId: data.transferId,
          details: { diverged },
        },
        client,
      );
      return { ok: true, status: diverged ? "diverged" : "received" };
    });
  });
