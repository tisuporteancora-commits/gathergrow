import type { PoolClient } from "pg";

export type MovementType =
  | "entry_manual"
  | "entry_purchase"
  | "entry_return_customer"
  | "entry_transfer"
  | "entry_inventory"
  | "exit_sale"
  | "exit_loss"
  | "exit_damage"
  | "exit_internal"
  | "exit_expiry"
  | "exit_return_supplier"
  | "exit_transfer"
  | "exit_inventory"
  | "exit_adjust";

export type ApplyMovementInput = {
  productId: number;
  warehouseId?: number | null;
  direction: "in" | "out";
  movementType: MovementType;
  qty: number;
  unitCost?: number | null;
  documentNumber?: string | null;
  reason?: string | null;
  notes?: string | null;
  sourceType?: string | null;
  sourceId?: number | null;
  supplierId?: number | null;
  transferId?: number | null;
  userId?: number | null;
  authorizedBy?: number | null;
  reversesId?: number | null;
  occurredAt?: Date | string | null;
  allowNegative?: boolean;
  updateProductCost?: boolean;
};

export type AppliedMovement = {
  movementId: number;
  balanceBefore: number;
  balanceAfter: number;
  warehouseId: number;
};

async function getDefaultWarehouseId(client: PoolClient): Promise<number> {
  const result = await client.query<{ id: number }>(
    `SELECT id FROM warehouses WHERE is_default = TRUE AND active = TRUE LIMIT 1`,
  );
  if (result.rows[0]) return result.rows[0].id;
  const any = await client.query<{ id: number }>(
    `SELECT id FROM warehouses WHERE active = TRUE ORDER BY id ASC LIMIT 1`,
  );
  if (!any.rows[0]) throw new Error("Nenhum depósito cadastrado. Execute a migração de estoque.");
  return any.rows[0].id;
}

export async function getAllowNegative(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ allow_negative: boolean }>(
    `SELECT allow_negative FROM stock_settings WHERE id = 1`,
  );
  return result.rows[0]?.allow_negative ?? false;
}

export async function applyStockMovement(
  client: PoolClient,
  input: ApplyMovementInput,
): Promise<AppliedMovement> {
  if (!(input.qty > 0)) throw new Error("Quantidade deve ser maior que zero.");

  const warehouseId = input.warehouseId ?? (await getDefaultWarehouseId(client));
  const allowNegative =
    input.allowNegative ?? (await getAllowNegative(client));

  const product = await client.query<{
    id: number;
    name: string;
    stock_qty: string;
    cost_price: string;
  }>(`SELECT id, name, stock_qty::text, cost_price::text FROM products WHERE id = $1 FOR UPDATE`, [
    input.productId,
  ]);
  const prod = product.rows[0];
  if (!prod) throw new Error(`Produto #${input.productId} não encontrado.`);

  await client.query(
    `INSERT INTO warehouse_stock (warehouse_id, product_id, qty)
     VALUES ($1, $2, 0)
     ON CONFLICT (warehouse_id, product_id) DO NOTHING`,
    [warehouseId, input.productId],
  );

  const wh = await client.query<{ qty: string }>(
    `SELECT qty::text FROM warehouse_stock
     WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE`,
    [warehouseId, input.productId],
  );
  const balanceBefore = Number(wh.rows[0]?.qty ?? 0);
  const delta = input.direction === "in" ? input.qty : -input.qty;
  const balanceAfter = balanceBefore + delta;

  if (!allowNegative && balanceAfter < -1e-9) {
    throw new Error(
      `Saldo insuficiente de "${prod.name}" no depósito (disponível: ${balanceBefore}).`,
    );
  }

  await client.query(
    `UPDATE warehouse_stock
     SET qty = $1, updated_at = NOW()
     WHERE warehouse_id = $2 AND product_id = $3`,
    [balanceAfter, warehouseId, input.productId],
  );

  // Mantém products.stock_qty como soma de todos os depósitos (compatível com PDV)
  const total = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(qty), 0)::text AS total FROM warehouse_stock WHERE product_id = $1`,
    [input.productId],
  );
  const totalQty = Number(total.rows[0]?.total ?? 0);

  const unitCost =
    input.unitCost != null && Number.isFinite(input.unitCost)
      ? input.unitCost
      : Number(prod.cost_price);
  const totalCost = unitCost * input.qty;

  if (input.updateProductCost && input.direction === "in" && input.unitCost != null) {
    await client.query(
      `UPDATE products
       SET stock_qty = $1, cost_price = $2, last_movement_at = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [totalQty, input.unitCost, input.productId],
    );
  } else {
    await client.query(
      `UPDATE products
       SET stock_qty = $1, last_movement_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [totalQty, input.productId],
    );
  }

  const mov = await client.query<{ id: number }>(
    `INSERT INTO stock_movements (
       product_id, warehouse_id, direction, movement_type, qty,
       balance_before, balance_after, unit_cost, total_cost,
       document_number, reason, notes, source_type, source_id,
       supplier_id, transfer_id, user_id, authorized_by, reverses_id, occurred_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
       COALESCE($20::timestamptz, NOW())
     )
     RETURNING id`,
    [
      input.productId,
      warehouseId,
      input.direction,
      input.movementType,
      input.qty,
      balanceBefore,
      balanceAfter,
      unitCost,
      totalCost,
      input.documentNumber ?? null,
      input.reason ?? null,
      input.notes ?? null,
      input.sourceType ?? null,
      input.sourceId ?? null,
      input.supplierId ?? null,
      input.transferId ?? null,
      input.userId ?? null,
      input.authorizedBy ?? null,
      input.reversesId ?? null,
      input.occurredAt ?? null,
    ],
  );

  const movementId = mov.rows[0]!.id;

  if (input.reversesId) {
    await client.query(`UPDATE stock_movements SET reversed_by = $1 WHERE id = $2`, [
      movementId,
      input.reversesId,
    ]);
  }

  return { movementId, balanceBefore, balanceAfter, warehouseId };
}

export async function reverseStockMovement(
  client: PoolClient,
  opts: {
    movementId: number;
    userId: number;
    authorizedBy?: number | null;
    reason: string;
  },
): Promise<AppliedMovement> {
  const orig = await client.query<{
    id: number;
    product_id: number;
    warehouse_id: number;
    direction: "in" | "out";
    movement_type: MovementType;
    qty: string;
    unit_cost: string | null;
    reversed_by: number | null;
    reverses_id: number | null;
  }>(`SELECT * FROM stock_movements WHERE id = $1 FOR UPDATE`, [opts.movementId]);

  const row = orig.rows[0];
  if (!row) throw new Error("Movimentação não encontrada.");
  if (row.reversed_by) throw new Error("Movimentação já estornada.");
  if (row.reverses_id) throw new Error("Não é possível estornar um estorno.");

  const reverseDirection = row.direction === "in" ? "out" : "in";
  const reverseType: MovementType =
    reverseDirection === "in" ? "entry_manual" : "exit_adjust";

  return applyStockMovement(client, {
    productId: row.product_id,
    warehouseId: row.warehouse_id,
    direction: reverseDirection,
    movementType: reverseType,
    qty: Number(row.qty),
    unitCost: row.unit_cost != null ? Number(row.unit_cost) : null,
    reason: opts.reason,
    notes: `Estorno da movimentação #${row.id}`,
    sourceType: "stock_reversal",
    sourceId: row.id,
    userId: opts.userId,
    authorizedBy: opts.authorizedBy ?? opts.userId,
    reversesId: row.id,
  });
}
