-- Extensão do módulo de estoque (idempotente)

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS email VARCHAR(120),
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS sku VARCHAR(64),
  ADD COLUMN IF NOT EXISTS brand VARCHAR(80),
  ADD COLUMN IF NOT EXISTS subcategory VARCHAR(80),
  ADD COLUMN IF NOT EXISTS unit VARCHAR(16) NOT NULL DEFAULT 'un',
  ADD COLUMN IF NOT EXISTS max_stock NUMERIC(12, 3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS supplier_id INTEGER,
  ADD COLUMN IF NOT EXISTS last_movement_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_sku
  ON products (sku)
  WHERE sku IS NOT NULL AND sku <> '';

CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  document VARCHAR(32),
  phone VARCHAR(32),
  email VARCHAR(120),
  address TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_products_supplier'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT fk_products_supplier
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS warehouses (
  id SERIAL PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  kind VARCHAR(24) NOT NULL DEFAULT 'store'
    CHECK (kind IN ('store', 'deposit', 'branch')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouses_default
  ON warehouses ((is_default))
  WHERE is_default = TRUE;

CREATE TABLE IF NOT EXISTS warehouse_stock (
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty NUMERIC(12, 3) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (warehouse_id, product_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  direction VARCHAR(8) NOT NULL CHECK (direction IN ('in', 'out')),
  movement_type VARCHAR(32) NOT NULL
    CHECK (movement_type IN (
      'entry_manual', 'entry_purchase', 'entry_return_customer', 'entry_transfer', 'entry_inventory',
      'exit_sale', 'exit_loss', 'exit_damage', 'exit_internal', 'exit_expiry',
      'exit_return_supplier', 'exit_transfer', 'exit_inventory', 'exit_adjust'
    )),
  qty NUMERIC(12, 3) NOT NULL CHECK (qty > 0),
  balance_before NUMERIC(12, 3) NOT NULL,
  balance_after NUMERIC(12, 3) NOT NULL,
  unit_cost NUMERIC(12, 2),
  total_cost NUMERIC(12, 2),
  document_number VARCHAR(80),
  reason TEXT,
  notes TEXT,
  source_type VARCHAR(32),
  source_id INTEGER,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  transfer_id INTEGER,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  authorized_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reverses_id INTEGER REFERENCES stock_movements(id) ON DELETE SET NULL,
  reversed_by INTEGER REFERENCES stock_movements(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON stock_movements(movement_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_warehouse ON stock_movements(warehouse_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_user ON stock_movements(user_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id SERIAL PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  from_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  to_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  status VARCHAR(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'shipped', 'received', 'cancelled', 'diverged')),
  notes TEXT,
  shipped_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  received_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id SERIAL PRIMARY KEY,
  transfer_id INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty_sent NUMERIC(12, 3) NOT NULL CHECK (qty_sent > 0),
  qty_received NUMERIC(12, 3),
  notes TEXT
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_stock_movements_transfer'
  ) THEN
    ALTER TABLE stock_movements
      ADD CONSTRAINT fk_stock_movements_transfer
      FOREIGN KEY (transfer_id) REFERENCES stock_transfers(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS inventory_counts (
  id SERIAL PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'counting', 'pending_approval', 'approved', 'cancelled')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS inventory_count_items (
  id SERIAL PRIMARY KEY,
  count_id INTEGER NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  system_qty NUMERIC(12, 3) NOT NULL,
  counted_qty NUMERIC(12, 3),
  variance NUMERIC(12, 3),
  notes TEXT,
  UNIQUE (count_id, product_id)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  status VARCHAR(24) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ordered', 'partial', 'received', 'cancelled')),
  expected_at DATE,
  notes TEXT,
  ordered_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty_ordered NUMERIC(12, 3) NOT NULL CHECK (qty_ordered > 0),
  qty_received NUMERIC(12, 3) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS stock_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  allow_negative BOOLEAN NOT NULL DEFAULT FALSE,
  stagnant_days INTEGER NOT NULL DEFAULT 90,
  near_expiry_days INTEGER NOT NULL DEFAULT 30
);

INSERT INTO stock_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

INSERT INTO warehouses (code, name, kind, is_default)
SELECT 'PRINCIPAL', 'Depósito Principal', 'deposit', TRUE
WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE is_default = TRUE);

-- Replica saldo atual dos produtos no depósito padrão (somente se ainda não houver saldo)
INSERT INTO warehouse_stock (warehouse_id, product_id, qty)
SELECT w.id, p.id, p.stock_qty
FROM products p
CROSS JOIN warehouses w
WHERE w.is_default = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM warehouse_stock ws
    WHERE ws.product_id = p.id AND ws.warehouse_id = w.id
  );
