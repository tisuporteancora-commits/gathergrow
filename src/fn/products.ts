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

const productInput = z.object({
  barcode: z.string().min(1).max(64),
  sku: z.string().max(64).nullable().optional(),
  name: z.string().min(1).max(160),
  description: z.string().max(2000).nullable().optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  subcategory: z.string().max(80).nullable().optional(),
  brand: z.string().max(80).nullable().optional(),
  supplierId: z.number().int().positive().nullable().optional(),
  unit: z.string().min(1).max(16).default("un"),
  costPrice: z.coerce.number().min(0),
  sellPrice: z.coerce.number().min(0),
  stockQty: z.coerce.number().optional(),
  minStock: z.coerce.number().min(0).default(0),
  maxStock: z.coerce.number().min(0).default(0),
  expiresAt: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  active: z.boolean().default(true),
});

export type ProductRow = {
  id: number;
  barcode: string;
  sku: string | null;
  name: string;
  description: string | null;
  category_id: number | null;
  category_name: string | null;
  subcategory: string | null;
  brand: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  unit: string;
  cost_price: string;
  sell_price: string;
  stock_qty: string;
  min_stock: string;
  max_stock: string;
  expires_at: string | null;
  image_url: string | null;
  active: boolean;
  last_movement_at: string | null;
};

const PRODUCT_SELECT = `
  SELECT p.id, p.barcode, p.sku, p.name, p.description,
         p.category_id, c.name AS category_name, p.subcategory, p.brand,
         p.supplier_id, s.name AS supplier_name, p.unit,
         p.cost_price::text, p.sell_price::text, p.stock_qty::text,
         p.min_stock::text, p.max_stock::text,
         p.expires_at::text, p.image_url, p.active,
         p.last_movement_at::text
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN suppliers s ON s.id = p.supplier_id
`;

export const listCategories = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  const result = await query<{ id: number; name: string; parent_id: number | null }>(
    `SELECT id, name, parent_id FROM categories ORDER BY name ASC`,
  );
  return result.rows;
});

export const upsertCategory = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.number().int().positive().optional(),
      name: z.string().min(1).max(80),
      parentId: z.number().int().positive().nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireUser();
    if (data.id) {
      const result = await query<{ id: number }>(
        `UPDATE categories SET name = $1, parent_id = $2 WHERE id = $3 RETURNING id`,
        [data.name.trim(), data.parentId ?? null, data.id],
      );
      if (!result.rows[0]) throw new Error("Categoria não encontrada.");
      return { id: result.rows[0].id };
    }
    const result = await query<{ id: number }>(
      `INSERT INTO categories (name, parent_id) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET parent_id = EXCLUDED.parent_id
       RETURNING id`,
      [data.name.trim(), data.parentId ?? null],
    );
    return { id: result.rows[0]!.id };
  });

export const listProducts = createServerFn({ method: "GET" })
  .validator(
    z
      .object({
        search: z.string().optional(),
        categoryId: z.number().int().positive().optional(),
        activeOnly: z.boolean().optional(),
        lowStock: z.boolean().optional(),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    await requireUser();
    const search = data?.search?.trim();
    const categoryId = data?.categoryId;
    const params: unknown[] = [];
    const where: string[] = [];

    if (search) {
      params.push(`%${search}%`);
      where.push(
        `(p.name ILIKE $${params.length} OR p.barcode ILIKE $${params.length} OR COALESCE(p.sku,'') ILIKE $${params.length})`,
      );
    }
    if (categoryId) {
      params.push(categoryId);
      where.push(`p.category_id = $${params.length}`);
    }
    if (data?.activeOnly !== false) {
      where.push(`p.active = TRUE`);
    }
    if (data?.lowStock) {
      where.push(`p.stock_qty <= p.min_stock`);
    }

    const sql = `
      ${PRODUCT_SELECT}
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY p.name ASC
      LIMIT 300`;

    const result = await query<ProductRow>(sql, params);
    return result.rows;
  });

export const upsertProduct = createServerFn({ method: "POST" })
  .validator(
    productInput.extend({
      id: z.number().int().positive().optional(),
      initialWarehouseId: z.number().int().positive().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const expiresAt = data.expiresAt?.trim() ? data.expiresAt.trim() : null;
    const sku = data.sku?.trim() || null;
    const description = data.description?.trim() || null;
    const subcategory = data.subcategory?.trim() || null;
    const brand = data.brand?.trim() || null;

    return withTransaction(async (client) => {
      if (data.id) {
        const prev = await client.query<{ stock_qty: string }>(
          `SELECT stock_qty::text FROM products WHERE id = $1 FOR UPDATE`,
          [data.id],
        );
        if (!prev.rows[0]) throw new Error("Produto não encontrado.");

        const result = await client.query<{ id: number }>(
          `UPDATE products SET
             barcode = $1, sku = $2, name = $3, description = $4,
             category_id = $5, subcategory = $6, brand = $7, supplier_id = $8,
             unit = $9, cost_price = $10, sell_price = $11,
             min_stock = $12, max_stock = $13, expires_at = $14,
             image_url = $15, active = $16, updated_at = NOW()
           WHERE id = $17
           RETURNING id`,
          [
            data.barcode.trim(),
            sku,
            data.name.trim(),
            description,
            data.categoryId ?? null,
            subcategory,
            brand,
            data.supplierId ?? null,
            data.unit || "un",
            data.costPrice,
            data.sellPrice,
            data.minStock,
            data.maxStock,
            expiresAt,
            data.imageUrl ?? null,
            data.active,
            data.id,
          ],
        );

        await writeAudit(
          {
            userId: user.id,
            action: "product_update",
            entityType: "product",
            entityId: data.id,
            details: { name: data.name },
          },
          client,
        );
        return { id: result.rows[0]!.id };
      }

      const initialQty = data.stockQty ?? 0;
      const result = await client.query<{ id: number }>(
        `INSERT INTO products
           (barcode, sku, name, description, category_id, subcategory, brand, supplier_id,
            unit, cost_price, sell_price, stock_qty, min_stock, max_stock,
            expires_at, image_url, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$12,$13,$14,$15,$16)
         RETURNING id`,
        [
          data.barcode.trim(),
          sku,
          data.name.trim(),
          description,
          data.categoryId ?? null,
          subcategory,
          brand,
          data.supplierId ?? null,
          data.unit || "un",
          data.costPrice,
          data.sellPrice,
          data.minStock,
          data.maxStock,
          expiresAt,
          data.imageUrl ?? null,
          data.active,
        ],
      );
      const id = result.rows[0]!.id;

      if (initialQty > 0) {
        await applyStockMovement(client, {
          productId: id,
          warehouseId: data.initialWarehouseId,
          direction: "in",
          movementType: "entry_manual",
          qty: initialQty,
          unitCost: data.costPrice,
          reason: "Saldo inicial no cadastro",
          userId: user.id,
          sourceType: "product_create",
          sourceId: id,
          updateProductCost: false,
        });
      }

      await writeAudit(
        {
          userId: user.id,
          action: "product_create",
          entityType: "product",
          entityId: id,
          details: { name: data.name, initialQty },
        },
        client,
      );
      return { id };
    });
  });

/** @deprecated Prefer stockEntry / stockExit — mantido para compatibilidade, gera movimento auditável */
export const adjustStock = createServerFn({ method: "POST" })
  .validator(
    z.object({
      productId: z.number().int().positive(),
      delta: z.coerce.number(),
      reason: z.string().min(1).optional(),
      warehouseId: z.number().int().positive().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (data.delta === 0) throw new Error("Ajuste não pode ser zero.");

    return withTransaction(async (client) => {
      const applied = await applyStockMovement(client, {
        productId: data.productId,
        warehouseId: data.warehouseId,
        direction: data.delta > 0 ? "in" : "out",
        movementType: data.delta > 0 ? "entry_manual" : "exit_adjust",
        qty: Math.abs(data.delta),
        reason: data.reason?.trim() || "Ajuste manual",
        userId: user.id,
        sourceType: "adjust",
      });
      return {
        id: data.productId,
        stock_qty: String(applied.balanceAfter),
        movementId: applied.movementId,
      };
    });
  });

export const searchProducts = createServerFn({ method: "GET" })
  .validator(z.object({ q: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireUser();
    const q = data.q.trim();
    const result = await query<ProductRow>(
      `${PRODUCT_SELECT}
       WHERE p.active = TRUE AND (p.barcode = $1 OR p.name ILIKE $2 OR COALESCE(p.sku,'') ILIKE $2)
       ORDER BY
         CASE WHEN p.barcode = $1 THEN 0 ELSE 1 END,
         p.name ASC
       LIMIT 20`,
      [q, `%${q}%`],
    );
    return result.rows;
  });
