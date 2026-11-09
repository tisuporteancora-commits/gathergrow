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

export type SupplierRow = {
  id: number;
  name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
};

export const listSuppliers = createServerFn({ method: "GET" })
  .validator(
    z
      .object({
        search: z.string().optional(),
        activeOnly: z.boolean().optional(),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    await requireUser();
    const search = data?.search?.trim();
    const params: unknown[] = [];
    const where: string[] = [];
    if (data?.activeOnly !== false) {
      where.push(`active = TRUE`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(
        `(name ILIKE $${params.length} OR COALESCE(document,'') ILIKE $${params.length} OR COALESCE(phone,'') ILIKE $${params.length})`,
      );
    }
    const result = await query<SupplierRow>(
      `SELECT id, name, document, phone, email, address, notes, active
       FROM suppliers
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY name ASC LIMIT 300`,
      params,
    );
    return result.rows;
  });

export const upsertSupplier = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.number().int().positive().optional(),
      name: z.string().min(1).max(160),
      document: z.string().max(32).nullable().optional(),
      phone: z.string().max(32).nullable().optional(),
      email: z.string().max(120).nullable().optional(),
      address: z.string().max(500).nullable().optional(),
      notes: z.string().max(1000).nullable().optional(),
      active: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireUser();
    if (data.id) {
      const result = await query<{ id: number }>(
        `UPDATE suppliers SET
           name=$1, document=$2, phone=$3, email=$4, address=$5, notes=$6,
           active=COALESCE($7, active)
         WHERE id=$8 RETURNING id`,
        [
          data.name.trim(),
          data.document?.trim() || null,
          data.phone?.trim() || null,
          data.email?.trim() || null,
          data.address?.trim() || null,
          data.notes?.trim() || null,
          data.active,
          data.id,
        ],
      );
      if (!result.rows[0]) throw new Error("Fornecedor não encontrado.");
      return { id: result.rows[0].id };
    }
    const result = await query<{ id: number }>(
      `INSERT INTO suppliers (name, document, phone, email, address, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        data.name.trim(),
        data.document?.trim() || null,
        data.phone?.trim() || null,
        data.email?.trim() || null,
        data.address?.trim() || null,
        data.notes?.trim() || null,
      ],
    );
    return { id: result.rows[0]!.id };
  });

export type PurchaseOrderRow = {
  id: number;
  code: string;
  supplier_id: number;
  supplier_name: string;
  warehouse_id: number;
  warehouse_name: string;
  status: string;
  expected_at: string | null;
  notes: string | null;
  ordered_at: string | null;
  received_at: string | null;
  created_at: string;
  total_cost: string;
  item_count: string;
};

export const listPurchaseOrders = createServerFn({ method: "GET" })
  .validator(z.object({ status: z.string().optional() }).optional())
  .handler(async ({ data }) => {
    await requireUser();
    const params: unknown[] = [];
    const where: string[] = [];
    if (data?.status) {
      params.push(data.status);
      where.push(`po.status = $${params.length}`);
    }
    const result = await query<PurchaseOrderRow>(
      `SELECT po.id, po.code, po.supplier_id, s.name AS supplier_name,
              po.warehouse_id, w.name AS warehouse_name, po.status,
              po.expected_at::text, po.notes, po.ordered_at::text,
              po.received_at::text, po.created_at::text,
              COALESCE((SELECT SUM(qty_ordered * unit_cost) FROM purchase_order_items i WHERE i.order_id = po.id),0)::text AS total_cost,
              (SELECT COUNT(*)::text FROM purchase_order_items i WHERE i.order_id = po.id) AS item_count
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       JOIN warehouses w ON w.id = po.warehouse_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY po.created_at DESC
       LIMIT 100`,
      params,
    );
    return result.rows;
  });

export const createPurchaseOrder = createServerFn({ method: "POST" })
  .validator(
    z.object({
      supplierId: z.number().int().positive(),
      warehouseId: z.number().int().positive(),
      expectedAt: z.string().nullable().optional(),
      notes: z.string().max(1000).nullable().optional(),
      items: z
        .array(
          z.object({
            productId: z.number().int().positive(),
            qtyOrdered: z.coerce.number().positive(),
            unitCost: z.coerce.number().min(0),
          }),
        )
        .min(1),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return withTransaction(async (client) => {
      const code = `OC-${Date.now().toString(36).toUpperCase()}`;
      const po = await client.query<{ id: number }>(
        `INSERT INTO purchase_orders
           (code, supplier_id, warehouse_id, status, expected_at, notes, ordered_at, created_by)
         VALUES ($1,$2,$3,'ordered',$4,$5,NOW(),$6)
         RETURNING id`,
        [
          code,
          data.supplierId,
          data.warehouseId,
          data.expectedAt || null,
          data.notes || null,
          user.id,
        ],
      );
      const orderId = po.rows[0]!.id;
      for (const item of data.items) {
        await client.query(
          `INSERT INTO purchase_order_items (order_id, product_id, qty_ordered, unit_cost)
           VALUES ($1,$2,$3,$4)`,
          [orderId, item.productId, item.qtyOrdered, item.unitCost],
        );
      }
      return { id: orderId, code };
    });
  });

export const getPurchaseOrder = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    await requireUser();
    const header = await query<PurchaseOrderRow>(
      `SELECT po.id, po.code, po.supplier_id, s.name AS supplier_name,
              po.warehouse_id, w.name AS warehouse_name, po.status,
              po.expected_at::text, po.notes, po.ordered_at::text,
              po.received_at::text, po.created_at::text,
              COALESCE((SELECT SUM(qty_ordered * unit_cost) FROM purchase_order_items i WHERE i.order_id = po.id),0)::text AS total_cost,
              (SELECT COUNT(*)::text FROM purchase_order_items i WHERE i.order_id = po.id) AS item_count
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       JOIN warehouses w ON w.id = po.warehouse_id
       WHERE po.id = $1`,
      [data.id],
    );
    if (!header.rows[0]) throw new Error("Pedido não encontrado.");
    const items = await query<{
      id: number;
      product_id: number;
      product_name: string;
      barcode: string;
      qty_ordered: string;
      qty_received: string;
      unit_cost: string;
    }>(
      `SELECT i.id, i.product_id, p.name AS product_name, p.barcode,
              i.qty_ordered::text, i.qty_received::text, i.unit_cost::text
       FROM purchase_order_items i
       JOIN products p ON p.id = i.product_id
       WHERE i.order_id = $1
       ORDER BY p.name`,
      [data.id],
    );
    return { ...header.rows[0], items: items.rows };
  });

export const receivePurchaseOrder = createServerFn({ method: "POST" })
  .validator(
    z.object({
      orderId: z.number().int().positive(),
      documentNumber: z.string().max(80).nullable().optional(),
      items: z
        .array(
          z.object({
            itemId: z.number().int().positive(),
            qtyReceived: z.coerce.number().min(0),
          }),
        )
        .min(1),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return withTransaction(async (client) => {
      const po = await client.query<{
        id: number;
        supplier_id: number;
        warehouse_id: number;
        status: string;
        code: string;
      }>(
        `SELECT id, supplier_id, warehouse_id, status, code
         FROM purchase_orders WHERE id = $1 FOR UPDATE`,
        [data.orderId],
      );
      const order = po.rows[0];
      if (!order) throw new Error("Pedido não encontrado.");
      if (order.status === "cancelled") throw new Error("Pedido cancelado.");
      if (order.status === "received") throw new Error("Pedido já recebido por completo.");

      let anyReceived = false;
      let allComplete = true;

      for (const recv of data.items) {
        const item = await client.query<{
          id: number;
          product_id: number;
          qty_ordered: string;
          qty_received: string;
          unit_cost: string;
        }>(
          `SELECT id, product_id, qty_ordered::text, qty_received::text, unit_cost::text
           FROM purchase_order_items WHERE id = $1 AND order_id = $2 FOR UPDATE`,
          [recv.itemId, data.orderId],
        );
        const row = item.rows[0];
        if (!row) continue;
        if (!(recv.qtyReceived > 0)) {
          if (Number(row.qty_received) + 1e-9 < Number(row.qty_ordered)) allComplete = false;
          continue;
        }

        anyReceived = true;
        const newReceived = Number(row.qty_received) + recv.qtyReceived;
        await client.query(
          `UPDATE purchase_order_items SET qty_received = $1 WHERE id = $2`,
          [newReceived, row.id],
        );

        await applyStockMovement(client, {
          productId: row.product_id,
          warehouseId: order.warehouse_id,
          direction: "in",
          movementType: "entry_purchase",
          qty: recv.qtyReceived,
          unitCost: Number(row.unit_cost),
          supplierId: order.supplier_id,
          documentNumber: data.documentNumber || order.code,
          reason: `Recebimento pedido ${order.code}`,
          userId: user.id,
          sourceType: "purchase_order",
          sourceId: order.id,
          updateProductCost: true,
        });

        if (newReceived + 1e-9 < Number(row.qty_ordered)) allComplete = false;
      }

      // Reavaliar todos os itens
      const check = await client.query<{ pending: string }>(
        `SELECT COUNT(*)::text AS pending FROM purchase_order_items
         WHERE order_id = $1 AND qty_received + 1e-9 < qty_ordered`,
        [data.orderId],
      );
      allComplete = Number(check.rows[0]?.pending ?? 0) === 0;

      if (!anyReceived) throw new Error("Informe ao menos uma quantidade recebida.");

      await client.query(
        `UPDATE purchase_orders
         SET status = $1,
             received_at = CASE WHEN $1 = 'received' THEN NOW() ELSE received_at END
         WHERE id = $2`,
        [allComplete ? "received" : "partial", data.orderId],
      );

      await writeAudit(
        {
          userId: user.id,
          action: "purchase_receive",
          entityType: "purchase_order",
          entityId: data.orderId,
          details: { documentNumber: data.documentNumber },
        },
        client,
      );
      return { ok: true, status: allComplete ? "received" : "partial" };
    });
  });

export const comparePurchaseCosts = createServerFn({ method: "GET" })
  .validator(z.object({ productId: z.number().int().positive() }))
  .handler(async ({ data }) => {
    await requireUser();
    const result = await query<{
      occurred_at: string;
      supplier_name: string | null;
      unit_cost: string;
      qty: string;
      document_number: string | null;
      source_type: string | null;
    }>(
      `SELECT m.occurred_at::text, s.name AS supplier_name, m.unit_cost::text,
              m.qty::text, m.document_number, m.source_type
       FROM stock_movements m
       LEFT JOIN suppliers s ON s.id = m.supplier_id
       WHERE m.product_id = $1
         AND m.direction = 'in'
         AND m.movement_type IN ('entry_purchase', 'entry_manual')
         AND m.unit_cost IS NOT NULL
       ORDER BY m.occurred_at DESC
       LIMIT 30`,
      [data.productId],
    );
    return result.rows;
  });
